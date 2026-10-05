import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Cloud, CloudRain, CloudSun, Delete, Fingerprint, Lock, Sun } from 'lucide-react'
import '../../styles/privacy-vault.css'
import { getPrefs, subscribePrefs } from './prefs.ts'
import { revealFromDecoy, unlock } from './vault.ts'
import { attemptPin, currentWaitMs } from './auth.ts'
import { formatWait } from './lockout.ts'
import { assertPlatformCredential, platformAuthAvailable } from './webauthn.ts'
import { blockAllWrites } from './incognito.ts'
import { browserWipeEnv, ERASE_PHRASE, phraseMatches, wipeEverything } from './wipe.ts'
import { INITIAL_CALC, pressCalc, type CalcKey } from './calc.ts'
import { isActiveDisguise, type ActiveDisguise } from './disguiseSpec.ts'
import { cn } from '@/lib/utils'

/* ─────────────────────────── lock screen ─────────────────────────── */

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

function LockScreen() {
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs, getPrefs)
  const pinLen = prefs.pin?.len || 0
  const [digits, setDigits] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [shake, setShake] = useState(0)
  const [waitMs, setWaitMs] = useState(() => currentWaitMs())
  const [bioReady, setBioReady] = useState(false)
  const [forgot, setForgot] = useState(false)
  const [phrase, setPhrase] = useState('')
  const [erasing, setErasing] = useState(false)
  const busyRef = useRef(false)
  const digitsRef = useRef('')
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => { cardRef.current?.focus({ preventScroll: true }) }, [])

  const waiting = waitMs > 0

  // Countdown while a backoff pause is active.
  useEffect(() => {
    if (!waiting) return
    const id = window.setInterval(() => {
      const left = currentWaitMs()
      setWaitMs(left)
      if (left <= 0) setMessage('')
    }, 500)
    return () => window.clearInterval(id)
  }, [waiting])

  useEffect(() => {
    let cancelled = false
    if (prefs.biometric) void platformAuthAvailable().then((ok) => { if (!cancelled) setBioReady(ok) })
    return () => { cancelled = true }
  }, [prefs.biometric])

  const submit = useCallback(async (pin: string) => {
    if (busyRef.current || pin.length < 4) return
    busyRef.current = true
    setBusy(true)
    const result = await attemptPin(pin)
    busyRef.current = false
    if (result.ok) { unlock(); return }
    setBusy(false)
    digitsRef.current = ''
    setDigits('')
    setShake((n) => n + 1)
    if (result.reason === 'locked') {
      setWaitMs(result.remainingMs)
      setMessage('Too many attempts. Please wait.')
    } else if (result.reason === 'wrong') {
      setWaitMs(result.remainingMs)
      setMessage(result.remainingMs > 0 ? 'Too many attempts. Please wait.' : `Incorrect PIN. ${result.freeLeft} ${result.freeLeft === 1 ? 'try' : 'tries'} before a pause.`)
    }
  }, [])

  const press = useCallback((digit: string) => {
    if (busyRef.current || waitMs > 0 || digitsRef.current.length >= 8) return
    setMessage('')
    const next = digitsRef.current + digit
    digitsRef.current = next
    setDigits(next)
    if (pinLen && next.length === pinLen) void submit(next)
  }, [pinLen, submit, waitMs])

  const back = useCallback(() => {
    if (busyRef.current) return
    digitsRef.current = digitsRef.current.slice(0, -1)
    setDigits(digitsRef.current)
  }, [])

  // Physical keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (forgot || event.metaKey || event.ctrlKey || event.altKey) return
      if (/^\d$/.test(event.key)) { event.preventDefault(); press(event.key) }
      else if (event.key === 'Backspace') { event.preventDefault(); back() }
      else if (event.key === 'Enter') { event.preventDefault(); void submit(digitsRef.current) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [forgot, press, back, submit])

  const tryBiometric = async () => {
    if (!prefs.biometric || busyRef.current) return
    setMessage('')
    if (await assertPlatformCredential(prefs.biometric)) unlock()
    else setMessage('Device unlock did not complete. Use your PIN.')
  }

  const erase = async () => {
    if (!phraseMatches(phrase) || erasing) return
    setErasing(true)
    await wipeEverything(browserWipeEnv(blockAllWrites))
    window.location.replace('/')
  }

  const dotCount = Math.min(Math.max(pinLen || 4, digits.length), 8)

  return (
    <div className="pv-screen pv-lock" data-pv-screen="" role="dialog" aria-modal="true" aria-labelledby="pv-lock-title">
      <div className="pv-card" ref={cardRef} tabIndex={-1}>
        <div className="pv-seal" aria-hidden="true"><Lock size={22} strokeWidth={1.6} /></div>
        <h1 id="pv-lock-title" className="pv-title">{forgot ? 'Start over?' : waiting ? 'Locked for a moment' : 'Enter your PIN'}</h1>
        <p className="pv-sub" role="status" aria-live="polite">
          {forgot ? 'Your PIN cannot be recovered.' : message || (waiting ? 'Too many incorrect attempts.' : 'This screen is locked on this device.')}
        </p>
        {waiting && !forgot && <p className="pv-wait" aria-hidden="true">Try again in {formatWait(waitMs)}</p>}

        {!forgot && (
          <>
            <div className="pv-dots" key={shake} data-shake={shake > 0 ? 'true' : undefined} aria-hidden="true">
              {Array.from({ length: dotCount }).map((_, i) => <i key={i} data-on={i < digits.length ? 'true' : undefined} />)}
            </div>
            <span className="sr-only" aria-live="polite">{digits.length} {digits.length === 1 ? 'digit' : 'digits'} entered</span>

            <div className="pv-pad" role="group" aria-label="PIN keypad" aria-disabled={waiting || undefined}>
              {KEYS.map((digit) => (
                <button key={digit} type="button" className="pv-key" disabled={waiting} onClick={() => press(digit)}>{digit}</button>
              ))}
              {prefs.biometric && bioReady ? (
                <button type="button" className="pv-key pv-key-ghost" aria-label="Unlock with this device" onClick={tryBiometric}>
                  <Fingerprint size={24} strokeWidth={1.5} aria-hidden="true" />
                </button>
              ) : <span aria-hidden="true" />}
              <button type="button" className="pv-key" disabled={waiting} onClick={() => press('0')}>0</button>
              <button type="button" className="pv-key pv-key-ghost" aria-label="Delete last digit" disabled={!digits.length} onClick={back}>
                <Delete size={22} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </div>

            <button type="button" className="btn-primary pv-go" disabled={digits.length < 4 || busy || waiting} onClick={() => void submit(digits)}>
              {busy ? 'Checking…' : 'Unlock'}
            </button>
          </>
        )}

        {!forgot ? (
          <button type="button" className="pv-link" aria-expanded="false" onClick={() => setForgot(true)}>Forgot PIN?</button>
        ) : (
          <div className="pv-forgot">
            <p>
              You can erase everything stored in this browser — history, likes, follows, settings and the PIN — and
              start over. This cannot be undone.
            </p>
            <label htmlFor="pv-erase-phrase">Type <b>{ERASE_PHRASE}</b> to confirm</label>
            <input
              id="pv-erase-phrase"
              autoFocus
              className="pv-input"
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder={ERASE_PHRASE}
            />
            <div className="pv-forgot-actions">
              <button type="button" className="btn-secondary" onClick={() => { setForgot(false); setPhrase('') }}>Cancel</button>
              <button type="button" className="btn-heat" disabled={!phraseMatches(phrase) || erasing} onClick={() => void erase()}>
                {erasing ? 'Erasing…' : 'Erase and start over'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────── decoys ─────────────────────────── */

/**
 * Hidden way back from a decoy: press-and-hold the page title for ~0.7 s, or
 * tap it three times. (Double-Escape is handled globally by the gate.)
 */
function useReveal() {
  const timer = useRef(0)
  const taps = useRef<number[]>([])
  const cancel = useCallback(() => window.clearTimeout(timer.current), [])
  return {
    onPointerDown: () => { timer.current = window.setTimeout(revealFromDecoy, 700) },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onClick: () => {
      const now = Date.now()
      taps.current = [...taps.current.filter((t) => now - t < 800), now]
      if (taps.current.length >= 3) { taps.current = []; revealFromDecoy() }
    },
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
  }
}

const dayName = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString(undefined, { weekday: 'short' })
const hourLabel = (offset: number) => {
  const d = new Date(Date.now() + offset * 3_600_000)
  return d.toLocaleTimeString(undefined, { hour: 'numeric' })
}
const baseTemp = (hours: number) => Math.round(66 + 9 * Math.sin(((new Date().getHours() + hours - 9) / 24) * Math.PI * 2))

function WeatherDecoy() {
  const reveal = useReveal()
  const [metric, setMetric] = useState(false)
  const deg = (f: number) => (metric ? Math.round(((f - 32) * 5) / 9) : f)
  const hours = Array.from({ length: 6 }, (_, i) => ({ label: i === 0 ? 'Now' : hourLabel(i), temp: baseTemp(i), Icon: i % 3 === 2 ? CloudSun : i === 4 ? Cloud : Sun }))
  const days = Array.from({ length: 5 }, (_, i) => ({ label: i === 0 ? 'Today' : dayName(i), hi: 71 + ((i * 3) % 6), lo: 54 + ((i * 2) % 5), Icon: [CloudSun, Sun, Cloud, CloudRain, Sun][i] }))
  return (
    <div className="pv-screen pv-weather" data-pv-screen="">
      <main className="pv-weather-main">
        <div className="pv-weather-head" {...reveal}>
          <h1>My Location</h1>
          <p>Portland</p>
        </div>
        <section className="pv-weather-now" aria-label="Current conditions">
          <p className="pv-weather-temp">{deg(baseTemp(0))}°</p>
          <p className="pv-weather-cond">Partly Cloudy</p>
          <p className="pv-weather-hl">H:{deg(75)}° L:{deg(54)}°</p>
        </section>
        <section className="pv-weather-card" aria-label="Hourly forecast">
          <h2>Hourly forecast</h2>
          <ul className="pv-hours">
            {hours.map(({ label, temp, Icon }) => (
              <li key={label}><span>{label}</span><Icon size={22} strokeWidth={1.5} aria-hidden="true" /><b>{deg(temp)}°</b></li>
            ))}
          </ul>
        </section>
        <section className="pv-weather-card" aria-label="5-day forecast">
          <h2>5-day forecast</h2>
          <ul className="pv-days">
            {days.map(({ label, hi, lo, Icon }) => (
              <li key={label}><span>{label}</span><Icon size={20} strokeWidth={1.5} aria-hidden="true" /><span>{deg(lo)}°</span><i aria-hidden="true" /><b>{deg(hi)}°</b></li>
            ))}
          </ul>
        </section>
        <button type="button" className="pv-weather-unit" onClick={() => setMetric((m) => !m)} aria-label={`Switch to °${metric ? 'F' : 'C'}`}>°{metric ? 'C' : 'F'} / °{metric ? 'F' : 'C'}</button>
      </main>
    </div>
  )
}

const NOTES = [
  { id: 'groceries', title: 'Groceries', when: 'Today', body: 'Oat milk\nEggs\nBasil\nLemons\nCoffee beans\nSourdough' },
  { id: 'weekend', title: 'Weekend plans', when: 'Yesterday', body: 'Farmers market, 9am\nCall Mom\nReturn the borrowed books\nLaundry\nTry the new ramen place' },
  { id: 'books', title: 'Book list', when: 'Tuesday', body: 'The Overstory\nPiranesi\nBraiding Sweetgrass\nProject Hail Mary\nA Psalm for the Wild-Built' },
  { id: 'meeting', title: 'Meeting notes', when: 'Last week', body: 'Q3 planning: align on milestones.\nFollow up with design about handoff.\nAction items due Friday.' },
]

function NotesDecoy() {
  const reveal = useReveal()
  const [selected, setSelected] = useState<string | null>(null)
  const note = NOTES.find((n) => n.id === selected) ?? NOTES[0]
  return (
    <div className="pv-screen pv-notes" data-pv-screen="" data-view={selected ? 'note' : 'list'}>
      <aside className="pv-notes-list" aria-label="Notes">
        <div className="pv-notes-head" {...reveal}>
          <h1>Notes</h1>
          <p>{NOTES.length} notes</p>
        </div>
        <ul>
          {NOTES.map((n) => (
            <li key={n.id}>
              <button type="button" aria-current={n.id === note.id ? 'true' : undefined} onClick={() => setSelected(n.id)}>
                <b>{n.title}</b>
                <span>{n.when} · {n.body.split('\n')[0]}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="pv-notes-editor" aria-label={note.title}>
        <button type="button" className="pv-notes-back" onClick={() => setSelected(null)}>‹ Notes</button>
        <h2>{note.title}</h2>
        <textarea key={note.id} aria-label={`${note.title} text`} defaultValue={note.body} spellCheck={false} />
      </section>
    </div>
  )
}

const CALC_LAYOUT: Array<{ key: CalcKey; label: string; kind?: 'fn' | 'op' | 'wide' }> = [
  { key: 'C', label: 'AC', kind: 'fn' }, { key: '±', label: '±', kind: 'fn' }, { key: '%', label: '%', kind: 'fn' }, { key: '/', label: '÷', kind: 'op' },
  { key: '7', label: '7' }, { key: '8', label: '8' }, { key: '9', label: '9' }, { key: '*', label: '×', kind: 'op' },
  { key: '4', label: '4' }, { key: '5', label: '5' }, { key: '6', label: '6' }, { key: '-', label: '−', kind: 'op' },
  { key: '1', label: '1' }, { key: '2', label: '2' }, { key: '3', label: '3' }, { key: '+', label: '+', kind: 'op' },
  { key: '0', label: '0', kind: 'wide' }, { key: '.', label: '.' }, { key: '=', label: '=', kind: 'op' },
]

function CalcDecoy() {
  const reveal = useReveal()
  const [state, setState] = useState(INITIAL_CALC)
  const press = useCallback((key: CalcKey) => setState((s) => pressCalc(s, key)), [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (/^[0-9.+\-*/%]$/.test(event.key)) press(event.key as CalcKey)
      else if (event.key === 'Enter' || event.key === '=') { event.preventDefault(); press('=') }
      else if (event.key === 'Backspace' || event.key === 'Delete') press('C')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press])
  return (
    <div className="pv-screen pv-calc" data-pv-screen="">
      <main className="pv-calc-body">
        <h1 className="sr-only" {...reveal}>Calculator</h1>
        <div className="pv-calc-title" aria-hidden="true" {...reveal}>Calculator</div>
        <output className="pv-calc-display" aria-live="polite">{state.display}</output>
        <div className="pv-calc-keys" role="group" aria-label="Calculator keys">
          {CALC_LAYOUT.map(({ key, label, kind }) => (
            <button key={key} type="button" className={cn('pv-ck', kind && `pv-ck-${kind}`)} data-active={state.op === key && state.fresh ? 'true' : undefined} onClick={() => press(key)}>{label}</button>
          ))}
        </div>
      </main>
    </div>
  )
}

export function Decoy({ kind }: { kind: ActiveDisguise }) {
  if (kind === 'notes') return <NotesDecoy />
  if (kind === 'calc') return <CalcDecoy />
  return <WeatherDecoy />
}

/* ─────────────────────────── entry ─────────────────────────── */

export default function VaultScreens({ mode }: { mode: 'locked' | 'decoy' }) {
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs, getPrefs)
  if (mode === 'locked') return <LockScreen />
  // Matches the neutral "Notes" tab identity used while concealed without a disguise.
  return <Decoy kind={isActiveDisguise(prefs.disguise) ? prefs.disguise : 'notes'} />
}


import { useEffect, useId, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import { EyeOff, Fingerprint, Lock, ShieldCheck, Trash2 } from 'lucide-react'
import '../../styles/privacy-vault.css'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { getPrefs, sanitizeSafeUrl, subscribePrefs, updatePrefs, type DisguiseId, type PrivacyPrefs } from './prefs.ts'
import { attemptPin } from './auth.ts'
import { hashPin, isValidPin, PIN_MAX, PIN_MIN, weakPinReason } from './pin.ts'
import { formatWait, NO_LOCKOUT, saveLockout } from './lockout.ts'
import { DISGUISES, iconDataUri, isActiveDisguise } from './disguise.ts'
import { blockAllWrites, isIncognito, setIncognito, subscribeIncognito } from './incognito.ts'
import { browserWipeEnv, wipeEverything } from './wipe.ts'
import { lockNow, panic } from './vault.ts'
import { platformAuthAvailable, registerPlatformCredential } from './webauthn.ts'

/* Small primitives that mirror the Settings page rows (same d-set-* classes). */

function Group({ title }: { title: string }) {
  return <p className="pv-group" role="presentation">{title}</p>
}

function Row({ label, hint, children, stack }: { label: string; hint?: ReactNode; children?: ReactNode; stack?: boolean }) {
  return (
    <div className={cn('d-set-row', stack && 'pv-row-stack')}>
      <div className="min-w-0 flex-1" style={{ minWidth: 180 }}>
        <p className="d-set-label">{label}</p>
        {hint && <p className="d-set-hint">{hint}</p>}
      </div>
      {children !== undefined && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <span className="d-switch-wrap">
      <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className="d-switch" style={disabled ? { opacity: 0.45 } : undefined} />
    </span>
  )
}

function Chips<T extends string | number>({ options, value, onChange, ariaLabel, disabled }: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  disabled?: boolean
}) {
  return (
    <div className="d-chips" style={{ flexWrap: 'wrap' }} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button key={String(option.value)} type="button" disabled={disabled} onClick={() => onChange(option.value)} className={cn('chip', value === option.value && 'chip-active')} aria-pressed={value === option.value}>
          {option.label}
        </button>
      ))}
    </div>
  )
}

/* ─────────────────────────── PIN form ─────────────────────────── */

type PinFlow = 'set' | 'change' | 'remove'

function PinField({ label, value, onChange, autoFocus, describedBy }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; describedBy?: string }) {
  const id = useId()
  return (
    <div className="pv-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="pv-input pv-pin-input"
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        maxLength={PIN_MAX}
        value={value}
        autoFocus={autoFocus}
        aria-describedby={describedBy}
        data-lpignore="true"
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, PIN_MAX))}
      />
    </div>
  )
}

function PinForm({ flow, onClose }: { flow: PinFlow; onClose: () => void }) {
  const addToast = useAppStore((s) => s.addToast)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const hintId = useId()
  const needsCurrent = flow !== 'set'
  const needsNew = flow !== 'remove'
  const weak = needsNew ? weakPinReason(next) : null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (needsNew && !isValidPin(next)) return setError(`Use ${PIN_MIN}–${PIN_MAX} digits.`)
    if (needsNew && next !== confirm) return setError('The two PINs do not match.')
    setBusy(true)
    try {
      if (needsCurrent) {
        const result = await attemptPin(current)
        if (!result.ok) {
          if (result.reason === 'locked' || (result.reason === 'wrong' && result.remainingMs > 0)) setError(`Too many attempts. Try again in ${formatWait(result.remainingMs)}.`)
          else setError('That is not your current PIN.')
          return
        }
      }
      if (flow === 'remove') {
        updatePrefs({ pin: null, biometric: null })
        saveLockout(NO_LOCKOUT)
        addToast({ type: 'success', title: 'PIN removed', message: 'The app no longer locks.' })
      } else {
        const record = await hashPin(next)
        updatePrefs({ pin: record })
        saveLockout(NO_LOCKOUT)
        addToast({ type: 'success', title: flow === 'set' ? 'PIN set' : 'PIN changed', message: 'Only a salted hash is stored on this device.' })
      }
      onClose()
    } catch {
      setError('This browser could not hash the PIN (WebCrypto is unavailable here).')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="pv-form" onSubmit={submit} aria-label={flow === 'set' ? 'Set PIN' : flow === 'change' ? 'Change PIN' : 'Remove PIN'}>
      {needsCurrent && <PinField label="Current PIN" value={current} onChange={setCurrent} autoFocus />}
      {needsNew && <PinField label={flow === 'change' ? 'New PIN' : 'PIN (4–8 digits)'} value={next} onChange={setNext} autoFocus={!needsCurrent} describedBy={hintId} />}
      {needsNew && <PinField label="Confirm PIN" value={confirm} onChange={setConfirm} />}
      <p id={hintId} className="pv-form-hint">
        {weak ?? (needsNew ? 'Avoid birthdays and repeated digits.' : 'Removing the PIN also turns off device unlock and auto-lock.')}
      </p>
      {error && <p className="pv-error" role="alert">{error}</p>}
      <div className="pv-form-actions">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className={flow === 'remove' ? 'btn-heat' : 'btn-primary'} disabled={busy || (needsCurrent && current.length < PIN_MIN) || (needsNew && next.length < PIN_MIN)}>
          {busy ? 'Working…' : flow === 'remove' ? 'Remove PIN' : flow === 'change' ? 'Change PIN' : 'Set PIN'}
        </button>
      </div>
    </form>
  )
}

/* ─────────────────────────── disguise picker ─────────────────────────── */

function DisguiseIcon({ id, size }: { id: DisguiseId; size: number }) {
  const src = isActiveDisguise(id) ? iconDataUri(id) : '/favicon.svg'
  return <img src={src} width={size} height={size} alt="" aria-hidden="true" data-pv-keep="" className="pv-icon" />
}

function DisguisePicker({ value, onChange }: { value: DisguiseId; onChange: (id: DisguiseId) => void }) {
  const options: { id: DisguiseId; label: string; blurb: string }[] = [
    { id: 'off', label: 'Media Codex', blurb: 'Default' },
    ...Object.values(DISGUISES).map((d) => ({ id: d.id as DisguiseId, label: d.label, blurb: d.blurb })),
  ]
  const spec = isActiveDisguise(value) ? DISGUISES[value] : null
  const name = spec ? spec.title : 'Media Codex'
  return (
    <div className="pv-disguise">
      <div className="pv-choices" role="group" aria-label="Disguise">
        {options.map((option) => (
          <button key={option.id} type="button" className="d-choice pv-choice" aria-pressed={value === option.id} onClick={() => onChange(option.id)}>
            <DisguiseIcon id={option.id} size={44} />
            <span>{option.label}</span>
            <small>{option.blurb}</small>
          </button>
        ))}
      </div>
      <div className="pv-preview" aria-label="Live preview" role="group">
        <div className="pv-preview-tab" data-pv-keep="">
          <DisguiseIcon id={value} size={16} />
          <span>{name}</span>
        </div>
        <div className="pv-preview-home" data-pv-keep="">
          <DisguiseIcon id={value} size={56} />
          <span>{spec ? spec.shortName : 'Media Codex'}</span>
        </div>
        <p>Preview of your browser tab and home-screen icon. Shortcuts you already installed keep their old name — add it again after choosing a disguise.</p>
      </div>
    </div>
  )
}

/* ─────────────────────────── section ─────────────────────────── */

const IDLE_CHOICES = [
  { value: 0, label: 'Off' },
  { value: 1, label: '1 min' },
  { value: 5, label: '5 min' },
  { value: 15, label: '15 min' },
]
const HIDDEN_CHOICES = [
  { value: 0, label: 'Right away' },
  { value: 15, label: '15 sec' },
  { value: 60, label: '1 min' },
  { value: 300, label: '5 min' },
  { value: -1, label: 'Never' },
]

function summary(prefs: PrivacyPrefs, incognito: boolean): string {
  const parts = [prefs.pin ? 'PIN on' : 'No PIN']
  if (prefs.pin) parts.push(prefs.idleMinutes ? `locks after ${prefs.idleMinutes} min idle` : 'no idle lock')
  parts.push(isActiveDisguise(prefs.disguise) ? `disguised as ${DISGUISES[prefs.disguise].title}` : 'not disguised')
  parts.push(incognito ? 'incognito on' : 'incognito off')
  return parts.join(' · ')
}

export default function PrivacySettings() {
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs, getPrefs)
  const incognito = useSyncExternalStore(subscribeIncognito, isIncognito, isIncognito)
  const addToast = useAppStore((s) => s.addToast)
  const [flow, setFlow] = useState<PinFlow | null>(null)
  const [bioAvailable, setBioAvailable] = useState<boolean | null>(null)
  const [bioBusy, setBioBusy] = useState(false)
  const [urlDraft, setUrlDraft] = useState(prefs.safeUrl)
  const [urlError, setUrlError] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const pinSet = !!prefs.pin

  useEffect(() => {
    let cancelled = false
    void platformAuthAvailable().then((ok) => { if (!cancelled) setBioAvailable(ok) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!confirmClear) return
    const id = window.setTimeout(() => setConfirmClear(false), 6000)
    return () => window.clearTimeout(id)
  }, [confirmClear])

  const toggleBiometric = async (on: boolean) => {
    if (!on) { updatePrefs({ biometric: null }); return }
    setBioBusy(true)
    try {
      const biometric = await registerPlatformCredential()
      updatePrefs({ biometric })
      addToast({ type: 'success', title: 'Device unlock enabled', message: 'Your PIN still works as a fallback.' })
    } catch {
      addToast({ type: 'error', title: 'Device unlock was not set up', message: 'It was cancelled or this device does not support it.' })
    } finally {
      setBioBusy(false)
    }
  }

  const commitUrl = () => {
    const clean = sanitizeSafeUrl(urlDraft)
    if (urlDraft.trim() && !clean) { setUrlError('Enter a valid http(s) address, for example https://example.com'); return }
    setUrlError('')
    setUrlDraft(clean)
    updatePrefs({ safeUrl: clean })
  }

  const toggleIncognito = (on: boolean) => {
    setIncognito(on)
    if (on) addToast({ type: 'info', title: 'Incognito is on', message: 'History is not saved on this device for this session.' })
    else window.location.reload() // drop any in-memory session history so it can never be saved later
  }

  const clearEverything = async () => {
    if (!confirmClear) { setConfirmClear(true); return }
    setClearing(true)
    await wipeEverything(browserWipeEnv(blockAllWrites))
    window.location.replace('/')
  }

  return (
    <section className="d-set" aria-label="Privacy & Vault" id="privacy-vault">
      <header className="d-set-head">
        <span className="d-set-icon" aria-hidden="true"><ShieldCheck size={17} strokeWidth={1.75} /></span>
        <div className="min-w-0">
          <h2 className="d-set-title">Privacy &amp; Vault</h2>
          <p className="d-set-desc" data-testid="vault-summary">{summary(prefs, incognito)}</p>
        </div>
      </header>

      <div>
        <Group title="App lock" />
        <Row
          label="PIN"
          hint={pinSet ? 'A 4–8 digit PIN guards this app. Only a salted, slow hash is stored — never the PIN.' : 'Set a 4–8 digit PIN to lock the app when you open it, go idle or switch away.'}
        >
          {!pinSet && flow !== 'set' && <button type="button" className="btn-secondary" onClick={() => setFlow('set')}><Lock size={14} strokeWidth={1.75} aria-hidden="true" /> Set PIN</button>}
          {pinSet && flow === null && (
            <>
              <button type="button" className="btn-secondary" onClick={() => setFlow('change')}>Change</button>
              <button type="button" className="btn-secondary" onClick={() => setFlow('remove')}>Remove</button>
            </>
          )}
        </Row>
        {flow && <div className="pv-form-wrap"><PinForm flow={flow} onClose={() => setFlow(null)} /></div>}

        <Row
          label="Unlock with this device"
          hint={
            bioAvailable === false
              ? 'Not available in this browser or on this device. Your PIN works everywhere.'
              : pinSet
                ? 'Face ID, Touch ID, Windows Hello or fingerprint. Checked on this device only — nothing is sent anywhere.'
                : 'Set a PIN first; device unlock is a shortcut to it.'
          }
        >
          <Toggle checked={!!prefs.biometric} disabled={!pinSet || !bioAvailable || bioBusy} onChange={(on) => void toggleBiometric(on)} label="Unlock with this device" />
          <Fingerprint size={16} strokeWidth={1.5} aria-hidden="true" className="pv-muted" />
        </Row>
        <Row label="Lock when idle" hint="Locks after no taps, clicks or keys for this long.">
          <Chips ariaLabel="Lock when idle" disabled={!pinSet} value={prefs.idleMinutes} onChange={(idleMinutes) => updatePrefs({ idleMinutes })} options={IDLE_CHOICES} />
        </Row>
        <Row label="Lock when hidden" hint="Locks after the tab or app has been in the background this long. “Right away” also covers the app switcher.">
          <Chips ariaLabel="Lock when hidden" disabled={!pinSet} value={prefs.hiddenSeconds} onChange={(hiddenSeconds) => updatePrefs({ hiddenSeconds })} options={HIDDEN_CHOICES} />
        </Row>
        <Row label="Lock on open" hint="Ask for the PIN every time the app loads.">
          <Toggle checked={prefs.lockOnLoad} disabled={!pinSet} onChange={(lockOnLoad) => updatePrefs({ lockOnLoad })} label="Lock on open" />
        </Row>
        {pinSet && (
          <Row label="Lock now">
            <button type="button" className="btn-secondary" onClick={lockNow}><Lock size={14} strokeWidth={1.75} aria-hidden="true" /> Lock</button>
          </Row>
        )}

        <Group title="Panic &amp; quick-hide" />
        <Row label="Double-tap Esc" hint="Esc twice, fast, swaps the whole screen for a decoy, leaves fullscreen and stops playback. Do the same on the decoy — or press and hold its title — to come back.">
          <Toggle checked={prefs.panicEscape} onChange={(panicEscape) => updatePrefs({ panicEscape })} label="Double-tap Escape to hide" />
        </Row>
        <Row label="Three-finger tap" hint="Tap the screen with three fingers at once (touch devices).">
          <Toggle checked={prefs.panicTouch} onChange={(panicTouch) => updatePrefs({ panicTouch })} label="Three-finger tap to hide" />
        </Row>
        <Row label="Hide button" hint="A small always-visible button in the corner of the screen.">
          <Chips ariaLabel="Hide button side" disabled={!prefs.panicButton} value={prefs.panicButtonSide} onChange={(panicButtonSide) => updatePrefs({ panicButtonSide })} options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} />
          <Toggle checked={prefs.panicButton} onChange={(panicButton) => updatePrefs({ panicButton })} label="Show hide button" />
        </Row>
        <Row label="Safe address" hint="Optional. After the decoy appears this tab opens that page, replacing this one in history." stack>
          <div className="pv-field pv-url">
            <label htmlFor="pv-safe-url" className="sr-only">Safe address</label>
            <input
              id="pv-safe-url"
              className="pv-input"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="https://example.com"
              value={urlDraft}
              aria-invalid={!!urlError}
              aria-describedby={urlError ? 'pv-url-error' : undefined}
              onChange={(event) => setUrlDraft(event.target.value)}
              onBlur={commitUrl}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitUrl() } }}
            />
            {urlError && <p id="pv-url-error" className="pv-error" role="alert">{urlError}</p>}
          </div>
        </Row>
        <Row label="Try it" hint="Hides the screen right now so you can see the decoy.">
          <button type="button" className="btn-secondary" onClick={() => { commitUrl(); window.setTimeout(panic, 0) }}><EyeOff size={14} strokeWidth={1.75} aria-hidden="true" /> Hide now</button>
        </Row>

        <Group title="Disguise" />
        <Row label="Name and icon" hint="Changes the tab title, favicon and home-screen name and icon to something ordinary. Applies instantly; also used by the decoy screen." stack>
          <DisguisePicker value={prefs.disguise} onChange={(disguise) => updatePrefs({ disguise })} />
        </Row>

        <Group title="Incognito &amp; screen guard" />
        <Row label="Incognito session" hint="Stops saving history on this device — recently viewed, watch progress, taste signals, searches and concierge chats. Likes, follows and collections you create still save. Turning it off reloads the app.">
          <Toggle checked={incognito} onChange={toggleIncognito} label="Incognito session" />
        </Row>
        <Row label="Blur thumbnails" hint="Every thumbnail stays blurred until you hover it (mouse) or tap it (touch).">
          <Toggle checked={prefs.blurThumbs} onChange={(blurThumbs) => updatePrefs({ blurThumbs })} label="Blur thumbnails" />
        </Row>
        <Row label="Blur when I switch away" hint="Veils and blurs the screen when this window loses focus or the tab goes to the background, including in app switchers.">
          <Toggle checked={prefs.blurAway} onChange={(blurAway) => updatePrefs({ blurAway })} label="Blur when I switch away" />
        </Row>

        <Group title="Erase" />
        <Row label="Clear everything now" hint="Erases all history, likes, follows, settings, the PIN and cached files from this browser, then reloads. This cannot be undone.">
          <button type="button" className={confirmClear ? 'btn-heat' : 'btn-secondary'} disabled={clearing} onClick={() => void clearEverything()}>
            <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
            {clearing ? 'Erasing…' : confirmClear ? 'Tap again to erase' : 'Clear everything now'}
          </button>
        </Row>

        <p className="pv-note">
          Honest limits: the PIN is a screen lock, not encryption — data stays readable by anyone with technical access to this
          browser profile. Your browser’s own history and address bar are outside this app’s control; use a private window for
          that. Nothing here ever leaves your device.
        </p>
      </div>
    </section>
  )
}

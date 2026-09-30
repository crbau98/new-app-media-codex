import { useEffect, useId, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Plus, Radar, RefreshCw, Search, UserRound, X } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { resolveCreators } from '@/lib/api'
import { creatorFollowId } from '@/lib/discovery'
import { useAppStore } from '@/store'
import type { Creator } from '@/lib/types'
import { CreatorAvatar, CreatorBadges } from '@/components/discovery/CreatorParts'
import { formatMetric } from '@/lib/discovery'
import {
  RADAR_CAP,
  candidateToCreator,
  handleKey,
  matchedByLabel,
  parseCreatorInput,
  type CreatorCandidate,
} from './creatorLogic'

const DEBOUNCE_MS = 350

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

interface CreatorFinderProps {
  onOpen: (creator: Creator) => void
}

/** "Find a creator": debounced resolver search with a listbox of candidate profiles. */
export default function CreatorFinder({ onOpen }: CreatorFinderProps) {
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const parsed = useMemo(() => parseCreatorInput(text), [text])
  const debounced = useDebounced(parsed.query, DEBOUNCE_MS)
  const enabled = debounced.length >= 2 && debounced === parsed.query

  const followCache = useAppStore((s) => s.followCache)
  const toggleFollow = useAppStore((s) => s.toggleFollow)
  const radar = useAppStore((s) => s.creatorWatchlist)
  const addToRadar = useAppStore((s) => s.addCreatorToWatchlist)
  const addToast = useAppStore((s) => s.addToast)

  const query = useQuery({
    queryKey: ['creator-resolve', debounced.toLowerCase()],
    queryFn: () => resolveCreators(debounced, 8),
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
  })
  const candidates = useMemo(() => (enabled ? query.data?.candidates ?? [] : []), [enabled, query.data])
  const typing = parsed.query.length >= 2 && !enabled
  const loading = typing || (enabled && query.isFetching && !query.data)
  const failed = enabled && query.isError
  const noMatch = enabled && query.isSuccess && candidates.length === 0
  const showPanel = parsed.kind !== 'empty' && parsed.query.length >= 2


  const onRadarKey = (handle: string) => radar.some((entry) => handleKey(entry) === handleKey(handle))
  const isFollowed = (candidate: CreatorCandidate) => Boolean(followCache[creatorFollowId(candidate.handle)])

  const follow = (candidate: CreatorCandidate) => {
    const next = !isFollowed(candidate)
    toggleFollow(creatorFollowId(candidate.handle))
    addToast({ type: next ? 'success' : 'info', title: next ? `Following @${candidate.handle}` : `Unfollowed @${candidate.handle}` })
  }
  const addRadar = (candidate: CreatorCandidate) => {
    if (onRadarKey(candidate.handle)) return
    if (radar.length >= RADAR_CAP) {
      addToast({ type: 'error', title: 'Radar is full', message: `Remove a handle first — the radar holds up to ${RADAR_CAP}.` })
      return
    }
    addToRadar(candidate.handle)
    addToast({ type: 'success', title: `Radar is scanning for @${candidate.handle}` })
  }
  const open = (candidate: CreatorCandidate) => onOpen(candidateToCreator(candidate))

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setText('')
      return
    }
    if (!candidates.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (index + 1) % candidates.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => (index - 1 + candidates.length) % candidates.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      open(candidates[active] ?? candidates[0])
    }
  }

  const hint =
    parsed.kind === 'url'
      ? `Profile link recognised — looking up @${parsed.handle}${parsed.platform ? ` on ${parsed.platform}` : ''}`
      : parsed.kind === 'handle'
        ? `Looking up @${parsed.handle}`
        : null

  return (
    <section aria-label="Find a creator" className="d-panel" data-testid="creator-finder">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="d-eyebrow">
          <Search size={12} strokeWidth={1.75} aria-hidden="true" /> Find a creator
        </h2>
        <p className="mono-meta">Name, @handle or a profile link</p>
      </div>
      <div className="d-field mt-3" style={{ flexBasis: '100%' }}>
        <Search size={16} strokeWidth={1.75} aria-hidden="true" />
        <input
          value={text}
          onChange={(event) => { setText(event.target.value); setActive(0) }}
          onKeyDown={onKeyDown}
          placeholder="Christian Hogue, @jakipz, redgifs.com/users/…"
          aria-label="Find a creator by name, handle or profile link"
          role="combobox"
          aria-expanded={candidates.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={candidates.length ? `${listId}-${active}` : undefined}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          className="d-input d-input-lg"
        />
        {text && (
          <button type="button" onClick={() => setText('')} className="d-field-clear" aria-label="Clear creator search">
            <X size={14} strokeWidth={1.75} />
          </button>
        )}
      </div>
      {hint && !failed && <p className="mono-meta mt-2">{hint}</p>}

      {showPanel && (
        <div className="mt-3" aria-live="polite">
          {loading && (
            <div className="grid gap-2" aria-busy="true" aria-label="Searching public sources">
              {[0, 1].map((n) => (
                <div key={n} className="d-skel d-skel-block" style={{ height: 76 }} />
              ))}
              <p className="mono-meta">Searching public sources…</p>
            </div>
          )}
          {failed && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-line-strong p-4">
              <p className="text-[13px] text-ink-2">Couldn&apos;t reach the creator lookup. Check your connection and try again.</p>
              <button type="button" className="btn-secondary min-h-11" onClick={() => void query.refetch()}>
                <RefreshCw size={13} strokeWidth={1.75} aria-hidden="true" /> Retry
              </button>
            </div>
          )}
          {noMatch && (
            <div role="status" className="rounded-2xl border border-dashed border-line-strong p-4">
              <p className="text-[13px] font-medium text-ink">No public match for “{debounced}”</p>
              <p className="mt-1 text-[13px] leading-5 text-ink-2">
                Try the exact handle, a different spelling, or paste the creator&apos;s profile link. Only public,
                source-attributed profiles are searched.
              </p>
              {query.data && query.data.tried.length > 0 && (
                <p className="mono-meta mt-2 break-words">Tried: {query.data.tried.slice(0, 8).join(', ')}</p>
              )}
            </div>
          )}
          {candidates.length > 0 && (
            <ul id={listId} role="listbox" aria-label={`Creators matching ${debounced}`} className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-2 p-0">
              {candidates.map((candidate, index) => {
                const creator = candidateToCreator(candidate)
                const followed = isFollowed(candidate)
                const onRadar = onRadarKey(candidate.handle)
                const posts = candidate.mediaCount != null ? `${candidate.mediaCount.toLocaleString()} posts` : null
                return (
                  <li
                    key={`${candidate.platform}-${candidate.handle}`}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === active}
                    data-testid="creator-candidate"
                    className={`rounded-2xl border bg-elevated p-3 ${index === active ? 'border-heat/60' : 'border-line'}`}
                    onMouseEnter={() => setActive(index)}
                  >
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => open(candidate)}
                        className="tap-highlight-none flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
                        aria-label={`Open profile of ${candidate.displayName} (@${candidate.handle})`}
                      >
                        <CreatorAvatar creator={creator} className="d-ccard-avatar !h-14 !w-14 !rounded-2xl" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">{candidate.displayName}</span>
                          <span className="mono-meta block break-words">
                            @{candidate.handle}
                            {posts ? ` · ${posts}` : ''}
                            {candidate.followers != null ? ` · ${formatMetric(candidate.followers)} fans` : ''}
                          </span>
                          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <CreatorBadges creator={creator} />
                            <span className="rounded-full bg-sunken px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-2" title={`Confidence ${Math.round(candidate.confidence * 100)}%`}>
                              {matchedByLabel(candidate.matchedBy)}
                            </span>
                          </span>
                        </span>
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className="btn-secondary min-h-11" onClick={() => open(candidate)}>
                        <UserRound size={13} strokeWidth={1.75} aria-hidden="true" /> Open profile
                      </button>
                      <button
                        type="button"
                        className="btn-secondary min-h-11"
                        aria-pressed={followed}
                        onClick={() => follow(candidate)}
                      >
                        {followed ? <Check size={13} strokeWidth={1.75} aria-hidden="true" /> : <Plus size={13} strokeWidth={1.75} aria-hidden="true" />}
                        {followed ? 'Following' : 'Follow'}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary min-h-11"
                        aria-pressed={onRadar}
                        disabled={onRadar}
                        onClick={() => addRadar(candidate)}
                      >
                        <Radar size={13} strokeWidth={1.75} aria-hidden="true" />
                        {onRadar ? 'On radar' : 'Add to radar'}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * Catalog of every player / queue / moments shortcut, shown by the `?` help
 * overlay. Entries that carry a `probe` are verified against the real key map
 * (`resolveKeyAction`) in unit tests, so the help can never drift from what
 * the keys actually do.
 */
import type { PlayerAction } from '../../lib/player/controls.ts'

export type ShortcutGroup = 'Playback' | 'Queue' | 'Moments' | 'View' | 'Sheet'

export interface ShortcutEntry {
  id: string
  group: ShortcutGroup
  /** Key caps as displayed, e.g. ['Shift', 'Q']. Alternatives are separate entries in `alt`. */
  keys: string[]
  /** Alternate key combos for the same action (rendered with "or"). */
  alt?: string[][]
  label: string
  /** When present, the key map must resolve `probe` to this action type. */
  action?: PlayerAction['type']
  probe?: { key: string; shiftKey?: boolean; paused?: boolean }
}

export const SHORTCUTS: readonly ShortcutEntry[] = [
  { id: 'toggle', group: 'Playback', keys: ['Space'], alt: [['K']], label: 'Play / pause', action: 'toggle', probe: { key: ' ' } },
  { id: 'seek-10', group: 'Playback', keys: ['J'], alt: [['L']], label: 'Back / forward 10 s', action: 'seek', probe: { key: 'j' } },
  { id: 'seek-5', group: 'Playback', keys: ['←'], alt: [['→']], label: 'Back / forward 5 s', action: 'seek', probe: { key: 'ArrowLeft' } },
  { id: 'volume', group: 'Playback', keys: ['↑'], alt: [['↓']], label: 'Volume up / down', action: 'volume', probe: { key: 'ArrowUp' } },
  { id: 'seek-percent', group: 'Playback', keys: ['0'], alt: [['9']], label: 'Jump to 0 – 90 %', action: 'seekPercent', probe: { key: '5' } },
  { id: 'frame', group: 'Playback', keys: [','], alt: [['.']], label: 'Step one frame (paused)', action: 'frame', probe: { key: '.', paused: true } },
  { id: 'rate', group: 'Playback', keys: ['<'], alt: [['>']], label: 'Slower / faster', action: 'rate', probe: { key: '>' } },
  { id: 'loop', group: 'Playback', keys: ['O'], label: 'Loop video', action: 'loop', probe: { key: 'o' } },
  { id: 'ab', group: 'Playback', keys: ['A'], label: 'Set A–B loop point (A, then B, then clear)', action: 'abLoop', probe: { key: 'a' } },

  { id: 'next', group: 'Queue', keys: ['N'], label: 'Next in queue', action: 'nextItem', probe: { key: 'n' } },
  { id: 'prev', group: 'Queue', keys: ['P'], label: 'Previous (or restart)', action: 'prevItem', probe: { key: 'p' } },
  { id: 'queue', group: 'Queue', keys: ['Q'], label: 'Open the queue', action: 'queue', probe: { key: 'q' } },
  { id: 'enqueue', group: 'Queue', keys: ['Shift', 'Q'], label: 'Add this to the queue', action: 'enqueue', probe: { key: 'Q', shiftKey: true } },
  { id: 'upnext-cancel', group: 'Queue', keys: ['Esc'], label: 'Cancel the Up next countdown' },
  { id: 'queue-reorder', group: 'Queue', keys: ['↑'], alt: [['↓']], label: 'Reorder a queue row (grip focused)' },

  { id: 'moment', group: 'Moments', keys: ['B'], label: 'Save a moment (or the A–B range as a clip)', action: 'moment', probe: { key: 'b' } },

  { id: 'mute', group: 'View', keys: ['M'], label: 'Mute', action: 'mute', probe: { key: 'm' } },
  { id: 'fullscreen', group: 'View', keys: ['F'], label: 'Fullscreen', action: 'fullscreen', probe: { key: 'f' } },
  { id: 'theatre', group: 'View', keys: ['T'], label: 'Theatre mode', action: 'theatre', probe: { key: 't' } },
  { id: 'pip', group: 'View', keys: ['I'], label: 'Picture-in-picture', action: 'pip', probe: { key: 'i' } },
  { id: 'capture', group: 'View', keys: ['C'], label: 'Capture the current frame', action: 'capture', probe: { key: 'c' } },
  { id: 'help', group: 'View', keys: ['?'], label: 'Show / hide this help', action: 'help', probe: { key: '?' } },

  { id: 'sheet-nav', group: 'Sheet', keys: ['Shift', '←'], alt: [['Shift', '→'], ['['], [']']], label: 'Previous / next item' },
  { id: 'save', group: 'Sheet', keys: ['S'], label: 'Save to your archive' },
  { id: 'follow', group: 'Sheet', keys: ['Shift', 'F'], label: 'Follow the creator' },
  { id: 'close', group: 'Sheet', keys: ['Esc'], label: 'Close' },
]

export const SHORTCUT_GROUP_ORDER: readonly ShortcutGroup[] = ['Playback', 'Queue', 'Moments', 'View', 'Sheet']

export function shortcutsByGroup(): Array<{ group: ShortcutGroup; entries: ShortcutEntry[] }> {
  return SHORTCUT_GROUP_ORDER.map((group) => ({ group, entries: SHORTCUTS.filter((entry) => entry.group === group) }))
}

/** Plain-text rendering of one entry, e.g. "Space or K". Used for aria-labels and tests. */
export function describeKeys(entry: ShortcutEntry): string {
  const combos = [entry.keys, ...(entry.alt ?? [])]
  return combos.map((combo) => combo.join('+')).join(' / ')
}

/**
 * Neutral identities for the disguise feature. Kept separate (tiny, eager) from
 * the icon/manifest generators in disguise.ts (lazy).
 */

import type { DisguiseId } from './prefs.ts'

export type ActiveDisguise = Exclude<DisguiseId, 'off'>

export interface DisguiseSpec {
  id: ActiveDisguise
  /** Label in the picker. */
  label: string
  /** document.title / manifest name. */
  title: string
  shortName: string
  themeColor: string
  backgroundColor: string
  blurb: string
}

export const DISGUISES: Record<ActiveDisguise, DisguiseSpec> = {
  notes: { id: 'notes', label: 'Notes', title: 'Notes', shortName: 'Notes', themeColor: '#f7c928', backgroundColor: '#fffdf4', blurb: 'A plain notepad' },
  weather: { id: 'weather', label: 'Weather', title: 'Weather', shortName: 'Weather', themeColor: '#2d6fd6', backgroundColor: '#2d6fd6', blurb: 'Forecast and conditions' },
  calc: { id: 'calc', label: 'Calculator', title: 'Calculator', shortName: 'Calc', themeColor: '#1c1c1e', backgroundColor: '#1c1c1e', blurb: 'A working calculator' },
}

export function isActiveDisguise(id: DisguiseId): id is ActiveDisguise {
  return id !== 'off'
}

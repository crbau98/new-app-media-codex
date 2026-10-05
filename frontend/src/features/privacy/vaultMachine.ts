/** Which screen the gate shows. Pure so the transitions are unit-tested. */

export type VaultMode = 'open' | 'locked' | 'decoy'
export type VaultEvent = 'panic' | 'lock' | 'reveal' | 'unlock'

export interface VaultContext {
  pinSet: boolean
}

export function initialMode(ctx: VaultContext & { lockOnLoad: boolean }): VaultMode {
  return ctx.pinSet && ctx.lockOnLoad ? 'locked' : 'open'
}

export function nextMode(mode: VaultMode, event: VaultEvent, ctx: VaultContext): VaultMode {
  switch (event) {
    case 'panic':
      return 'decoy'
    case 'lock':
      // Locking needs a credential; an already-hidden decoy stays hidden.
      if (!ctx.pinSet) return mode
      return mode === 'decoy' ? 'decoy' : 'locked'
    case 'reveal':
      // The hidden gesture on the decoy: ask for the PIN if there is one.
      if (mode !== 'decoy') return mode
      return ctx.pinSet ? 'locked' : 'open'
    case 'unlock':
      return 'open'
  }
}

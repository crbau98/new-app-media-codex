/**
 * Pure state machine for the calculator decoy: a plain "immediate execution"
 * calculator (like a pocket one). Believable because it actually works.
 */

export type CalcOp = '+' | '-' | '*' | '/'

export interface CalcState {
  /** Text currently on the display. */
  display: string
  /** Left operand waiting for a right one. */
  acc: number | null
  op: CalcOp | null
  /** Next digit starts a new number. */
  fresh: boolean
}

export const INITIAL_CALC: CalcState = { display: '0', acc: null, op: null, fresh: true }

export type CalcKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | '+' | '-' | '*' | '/' | '=' | 'C' | '±' | '%'

function apply(a: number, op: CalcOp, b: number): number {
  switch (op) {
    case '+': return a + b
    case '-': return a - b
    case '*': return a * b
    case '/': return b === 0 ? NaN : a / b
  }
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return 'Error'
  const rounded = Number(value.toPrecision(10))
  const text = String(rounded)
  if (text.length <= 11) return text
  return rounded.toExponential(5).replace(/\.?0+e/, 'e')
}

const isDigit = (key: string) => key.length === 1 && key >= '0' && key <= '9'

export function pressCalc(state: CalcState, key: CalcKey): CalcState {
  if (state.display === 'Error' && key !== 'C') return state
  if (isDigit(key)) {
    if (state.fresh) return { ...state, display: key, fresh: false }
    if (state.display.replace(/[-.]/g, '').length >= 9) return state
    return { ...state, display: state.display === '0' ? key : state.display + key }
  }
  switch (key) {
    case '.':
      if (state.fresh) return { ...state, display: '0.', fresh: false }
      return state.display.includes('.') ? state : { ...state, display: `${state.display}.` }
    case 'C':
      return INITIAL_CALC
    case '±':
      return state.display === '0' ? state : { ...state, display: state.display.startsWith('-') ? state.display.slice(1) : `-${state.display}` }
    case '%':
      return { ...state, display: formatNumber(Number(state.display) / 100), fresh: true }
    case '=': {
      if (state.op === null || state.acc === null) return { ...state, fresh: true }
      const result = apply(state.acc, state.op, Number(state.display))
      return { display: formatNumber(result), acc: null, op: null, fresh: true }
    }
    default: {
      // + - * /
      const op = key as CalcOp
      const current = Number(state.display)
      if (state.op !== null && state.acc !== null && !state.fresh) {
        const result = apply(state.acc, state.op, current)
        return { display: formatNumber(result), acc: result, op, fresh: true }
      }
      return { ...state, acc: current, op, fresh: true }
    }
  }
}

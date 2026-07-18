import { useEffect, type RefObject } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'

/**
 * Minimal focus trap for modal surfaces (drawers, sheets, dialogs).
 * - Moves focus into the container on mount
 * - Cycles Tab / Shift+Tab within the container
 * - Restores focus to the previously focused element on cleanup
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return
    const container = ref.current
    if (!container) return

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusFirst = () => {
      const target = container.querySelector<HTMLElement>(FOCUSABLE) ?? container
      target.focus()
    }
    // Delay so enter animations don't steal the focus back.
    const timer = window.setTimeout(focusFirst, 60)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      )
      if (!focusable.length) {
        event.preventDefault()
        container.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      } else if (!container.contains(document.activeElement)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown, true)
      previous?.focus()
    }
  }, [ref, active])
}

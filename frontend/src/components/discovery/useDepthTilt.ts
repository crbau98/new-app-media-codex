import { useEffect, type RefObject } from 'react'

/**
 * Pointer-driven 3D tilt + glare. Purely imperative (CSS variables written
 * inside a rAF), so pointer movement never re-renders React. Only mouse
 * pointers drive it; touch and pen are ignored, and callers pass
 * `enabled=false` for reduced motion / coarse pointers.
 *
 * Paired with `.d-tilt` in styles/discovery.css.
 */
export function useDepthTilt(ref: RefObject<HTMLElement | null>, enabled: boolean, max = 7) {
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    let frame = 0
    let rect: DOMRect | null = null

    const reset = () => {
      rect = null
      cancelAnimationFrame(frame)
      delete el.dataset.tilt
      el.style.setProperty('--rx', '0deg')
      el.style.setProperty('--ry', '0deg')
    }
    const onEnter = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      rect = el.getBoundingClientRect()
      el.dataset.tilt = 'on'
    }
    const onMove = (event: PointerEvent) => {
      if (!rect || event.pointerType !== 'mouse') return
      const { clientX, clientY } = event
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!rect) return
        const px = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
        const py = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
        el.style.setProperty('--ry', `${((px - 0.5) * 2 * max).toFixed(2)}deg`)
        el.style.setProperty('--rx', `${((0.5 - py) * 2 * max).toFixed(2)}deg`)
        el.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`)
        el.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`)
      })
    }

    el.addEventListener('pointerenter', onEnter)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', reset)
    el.addEventListener('pointercancel', reset)
    return () => {
      el.removeEventListener('pointerenter', onEnter)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', reset)
      el.removeEventListener('pointercancel', reset)
      cancelAnimationFrame(frame)
    }
  }, [ref, enabled, max])
}

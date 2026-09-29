import { useEffect, useState, type RefObject } from 'react'

/** True while the referenced element intersects the viewport (with a margin). */
export function useInViewport(ref: RefObject<Element | null>, rootMargin = '120px'): boolean {
  const [inView, setInView] = useState(true)
  useEffect(() => {
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => setInView(entries[entries.length - 1].isIntersecting), { rootMargin })
    io.observe(node)
    return () => io.disconnect()
  }, [ref, rootMargin])
  return inView
}

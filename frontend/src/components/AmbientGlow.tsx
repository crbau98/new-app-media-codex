import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'

export default function AmbientGlow() {
  const theme = useAppStore((s) => s.theme)
  const [enabled, setEnabled] = useState(false)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const isDesktop = window.innerWidth >= 1024
    setEnabled(theme === 'dark' && isDesktop)

    const handler = () => {
      setEnabled(theme === 'dark' && window.innerWidth >= 1024)
    }
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [theme])

  useEffect(() => {
    if (!enabled) return

    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        document.documentElement.style.setProperty('--cursor-x', `${e.clientX}px`)
        document.documentElement.style.setProperty('--cursor-y', `${e.clientY}px`)
      })
    }

    window.addEventListener('mousemove', onMove, { passive: true })
    return () => {
      window.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(rafRef.current)
    }
  }, [enabled])

  if (!enabled) return null

  return (
    <div
      className="fixed inset-0 pointer-events-none z-0"
      style={{
        background: `radial-gradient(200px circle at var(--cursor-x) var(--cursor-y), rgba(232,121,169,0.08), transparent 60%)`,
      }}
      aria-hidden="true"
    />
  )
}

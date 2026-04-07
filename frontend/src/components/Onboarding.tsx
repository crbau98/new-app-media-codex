import { useState, useEffect, useCallback } from "react"

interface Step {
  title: string
  description: string
  icon: React.ReactNode
}

function PulseIcon() {
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
      <rect x="10" y="12" width="60" height="56" rx="12" stroke="#14b8a6" strokeWidth="1.5" />
      <circle cx="26" cy="28" r="4" fill="#14b8a6" opacity="0.7" />
      <path d="M18 52h12l6-10 8 14 6-8h12" stroke="#60a5fa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CreatorsIcon() {
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
      <circle cx="28" cy="28" r="10" stroke="#60a5fa" strokeWidth="1.5" />
      <circle cx="52" cy="26" r="8" stroke="#14b8a6" strokeWidth="1.5" />
      <path d="M14 58c0-8 6.5-14 14-14s14 6 14 14" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M40 58c0-6.5 5-11.5 12-11.5S64 51.5 64 58" stroke="#14b8a6" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function CaptureIcon() {
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
      <rect x="12" y="18" width="56" height="42" rx="10" stroke="#60a5fa" strokeWidth="1.5" />
      <circle cx="40" cy="39" r="11" stroke="#14b8a6" strokeWidth="1.5" />
      <path d="M26 18l5-6h18l5 6" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M40 28v6M40 44h.01" stroke="#14b8a6" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function ReadyIcon() {
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
      <circle cx="40" cy="40" r="28" stroke="url(#rg)" strokeWidth="2" />
      <path d="M28 40l8 8 16-16" stroke="url(#rg)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <defs>
        <linearGradient id="rg" x1="12" y1="12" x2="68" y2="68">
          <stop stopColor="#14b8a6" />
          <stop offset="1" stopColor="#60a5fa" />
        </linearGradient>
      </defs>
    </svg>
  )
}

const STEPS: Step[] = [
  {
    title: "Welcome to your media workspace",
    description: "This app is built around one fast loop: browse media, open a creator, capture more content, and jump right back into review.",
    icon: <PulseIcon />,
  },
  {
    title: "Media is the main surface",
    description: "Use Media to search, filter, rate, tag, and scrub through the latest image and video captures without the rest of the old dashboard getting in the way.",
    icon: <PulseIcon />,
  },
  {
    title: "Creators drives capture",
    description: "Use Creators to manage profiles, queue new captures, discover similar creators, and track who needs refreshing next.",
    icon: <CreatorsIcon />,
  },
  {
    title: "Capture is now the key action",
    description: "If you want more content, jump to a creator and capture there, or trigger a capture run from the shell. New previews should show up much faster than before.",
    icon: <CaptureIcon />,
  },
  {
    title: "You’re ready",
    description: "Start in Media, use Creators when you want to add or refresh someone, and use ⌘K any time to jump directly where you need to go.",
    icon: <ReadyIcon />,
  },
]

export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState<"next" | "back">("next")
  const [animating, setAnimating] = useState(false)

  const isFirst = step === 0
  const isLast = step === STEPS.length - 1

  const complete = useCallback(() => {
    onComplete()
  }, [onComplete])

  const goNext = useCallback(() => {
    if (isLast) {
      complete()
      return
    }
    setDirection("next")
    setAnimating(true)
    setTimeout(() => {
      setStep((s) => Math.min(s + 1, STEPS.length - 1))
      setAnimating(false)
    }, 180)
  }, [complete, isLast])

  const goBack = useCallback(() => {
    if (isFirst) return
    setDirection("back")
    setAnimating(true)
    setTimeout(() => {
      setStep((s) => Math.max(s - 1, 0))
      setAnimating(false)
    }, 180)
  }, [isFirst])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault()
        goNext()
      } else if (e.key === "ArrowLeft") {
        e.preventDefault()
        goBack()
      } else if (e.key === "Escape") {
        e.preventDefault()
        complete()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [complete, goBack, goNext])

  const current = STEPS[step]
  const slideClass = animating ? (direction === "next" ? "translate-x-4 opacity-0" : "-translate-x-4 opacity-0") : "translate-x-0 opacity-100"

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-[2px]">
      <div className="relative mx-4 w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-bg-surface shadow-2xl">
        {!isLast && (
          <button onClick={complete} className="absolute right-4 top-4 z-10 text-xs text-text-muted transition-colors hover:text-text-primary">
            Skip
          </button>
        )}

        <div className={`px-8 pb-6 pt-10 transition-[transform,opacity] duration-200 ease-out ${slideClass}`}>
          <div className="mb-6 flex justify-center text-text-muted">{current.icon}</div>
          <h2 className="mb-2 text-center text-lg font-semibold text-text-primary">{current.title}</h2>
          <p className="text-center text-sm leading-relaxed text-text-muted">{current.description}</p>
        </div>

        <div className="px-8 pb-4">
          <div className="mb-5 flex items-center justify-center gap-2">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-[width,background-color] duration-200 ${i === step ? "w-6 bg-accent" : "w-1.5 bg-white/15"}`}
              />
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <button
              onClick={goBack}
              disabled={isFirst}
              className="rounded-xl border border-white/10 px-4 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              Back
            </button>
            <button
              onClick={goNext}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90"
            >
              {isLast ? "Start browsing" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function resetOnboarding() {
  // storage removed
}

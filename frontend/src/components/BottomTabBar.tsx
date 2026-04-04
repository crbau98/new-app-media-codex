import { startTransition } from "react"
import { cn } from "@/lib/cn"
import { useAppStore, type ActiveView } from "../store"
import { prefetchViewModule } from "@/lib/view-loader"

interface TabItem {
  id: ActiveView
  label: string
  icon: React.ReactNode
}

const TABS: TabItem[] = [
  {
    id: "images",
    label: "Media",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-5-5L5 21" />
      </svg>
    ),
  },
  {
    id: "performers",
    label: "Creators",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "Settings",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
      </svg>
    ),
  },
]

export function BottomTabBar() {
  const activeView = useAppStore((s) => s.activeView)
  const setActiveView = useAppStore((s) => s.setActiveView)

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-white/8 bg-[#08111a]/95 backdrop-blur-xl md:hidden"
      aria-label="Mobile navigation"
    >
      {TABS.map((tab) => {
        const isActive = activeView === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => {
              startTransition(() => {
                setActiveView(tab.id)
              })
            }}
            onTouchStart={() => prefetchViewModule(tab.id)}
            onMouseEnter={() => prefetchViewModule(tab.id)}
            onFocus={() => prefetchViewModule(tab.id)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] transition-colors",
              isActive ? "text-text-primary" : "text-text-muted"
            )}
          >
            {isActive && (
              <span
                aria-hidden="true"
                className="absolute inset-x-3 top-0 h-0.5 rounded-b-full bg-accent"
                style={{
                  background: "linear-gradient(90deg, transparent, var(--color-accent), transparent)",
                  boxShadow: "0 0 12px var(--color-accent-glow)",
                }}
              />
            )}
            <span className={cn("transition-transform", isActive && "scale-110")}>
              {tab.icon}
            </span>
            <span className="font-medium">{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

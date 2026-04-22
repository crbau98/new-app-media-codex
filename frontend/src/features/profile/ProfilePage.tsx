import { useAppStore } from '@/store'
import { Settings, Heart, Image, Users, Bookmark } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'

const TABS = [
  { key: 'media', label: 'Media', icon: Image },
  { key: 'liked', label: 'Liked', icon: Heart },
  { key: 'playlists', label: 'Playlists', icon: Bookmark },
  { key: 'following', label: 'Following', icon: Users },
] as const

export default function ProfilePage() {
  const [activeTab, setActiveTab] = useState<'media' | 'liked' | 'playlists' | 'following'>('media')
  const recentlyViewed = useAppStore((s) => s.recentlyViewed)

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent/20 text-2xl font-bold text-accent">
          U
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-text-primary">User</h1>
          <p className="text-sm text-text-muted">@default</p>
          <div className="mt-2 flex gap-4 text-sm">
            <span className="text-text-secondary"><strong className="text-text-primary">{recentlyViewed.size}</strong> viewed</span>
            <span className="text-text-secondary"><strong className="text-text-primary">0</strong> likes</span>
            <span className="text-text-secondary"><strong className="text-text-primary">0</strong> following</span>
          </div>
        </div>
        <button className="rounded-lg border border-border bg-bg-elevated p-2 text-text-muted hover:text-text-primary">
          <Settings size={18} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'border-b-2 border-accent text-accent'
                  : 'text-text-muted hover:text-text-secondary'
              )}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div className="text-center py-12 text-text-muted">
        <p className="text-sm">{activeTab === 'media' && 'Your saved media will appear here.'}</p>
        <p className="text-sm">{activeTab === 'liked' && 'Media you liked will appear here.'}</p>
        <p className="text-sm">{activeTab === 'playlists' && 'Your playlists will appear here.'}</p>
        <p className="text-sm">{activeTab === 'following' && 'Creators you follow will appear here.'}</p>
      </div>
    </div>
  )
}

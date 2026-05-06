import { useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import {
  mediaItems,
  categories,
  creators,
  getTrendingItems,
  type MediaItem,
} from '@/lib/mockData'
import MediaDetail from '@/components/MediaDetail'
import {
  Shuffle,
  Moon,
  Sunrise,
  Zap,
  BookOpen,
  Compass,
  Heart,
  Sparkles,
  ArrowRight,
  Eye,
  Play,
  MessageCircle,
  Share2,
  Bookmark,
  Download,
  X,
} from 'lucide-react'

/* ────────────────────────────────────────────────
   Easing constants
   ──────────────────────────────────────────────── */
const easeOutExpo = [0.16, 1, 0.3, 1] as [number, number, number, number]
const easeSpring = [0.34, 1.56, 0.64, 1] as [number, number, number, number]

/* ────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────── */
function formatViews(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return `${n}`
}

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const hours = Math.floor((+now - +d) / 3600000)
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

function seedUrl(seed: number, width = 400, height = 300): string {
  return `https://picsum.photos/seed/${seed}/${width}/${height}`
}

/* ────────────────────────────────────────────────
   Section 1 — Gradient Mesh Hero Banner
   ──────────────────────────────────────────────── */
function ExploreHero() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: easeOutExpo }}
      className="relative w-full h-[200px] md:h-[320px] rounded-[var(--radius-lg)] overflow-hidden mb-6"
    >
      {/* Animated gradient mesh background */}
      <div className="absolute inset-0 bg-[var(--bg-elevated)]">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            background:
              'radial-gradient(circle at 20% 50%, rgba(232,121,169,0.15) 0%, transparent 50%), radial-gradient(circle at 80% 50%, rgba(167,139,250,0.12) 0%, transparent 50%), radial-gradient(circle at 50% 80%, rgba(232,121,169,0.08) 0%, transparent 50%)',
          }}
        />
        <motion.div
          className="absolute w-[300px] h-[300px] rounded-full blur-[80px]"
          style={{ background: 'rgba(232,121,169,0.12)', top: '10%', left: '15%' }}
          animate={{ x: [0, 30, -20, 0], y: [0, -20, 30, 0] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        />
        <motion.div
          className="absolute w-[250px] h-[250px] rounded-full blur-[60px]"
          style={{ background: 'rgba(139,92,246,0.10)', top: '40%', right: '20%' }}
          animate={{ x: [0, -25, 15, 0], y: [0, 25, -15, 0] }}
          transition={{ duration: 25, repeat: Infinity, ease: 'linear' }}
        />
        <motion.div
          className="absolute w-[200px] h-[200px] rounded-full blur-[60px]"
          style={{ background: 'rgba(232,121,169,0.08)', bottom: '10%', left: '40%' }}
          animate={{ x: [0, 20, -30, 0], y: [0, -15, 20, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
        />
      </div>

      {/* Content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 gap-3">
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4, ease: easeOutExpo }}
          className="hero-title text-[var(--text-primary)]"
        >
          Discover
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4, ease: easeOutExpo }}
          className="text-sm text-[var(--text-secondary)]"
        >
          Find your next obsession
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.4, ease: easeOutExpo }}
          className="flex items-center gap-2 text-[11px] font-mono text-[var(--text-tertiary)]"
        >
          <span>48 videos</span>
          <span>•</span>
          <span>1,399 images</span>
          <span>•</span>
          <span>12 creators this week</span>
        </motion.div>
        <motion.button
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.4, ease: easeOutExpo }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="mt-2 flex items-center gap-2 px-5 py-2.5 rounded-full bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] transition-colors shadow-glow"
        >
          <Shuffle size={16} />
          Surprise Me
        </motion.button>
      </div>
    </motion.div>
  )
}

/* ────────────────────────────────────────────────
   Section 2 — Trending Now Rail
   ──────────────────────────────────────────────── */
function TrendingRail({ onSelect }: { onSelect: (item: MediaItem) => void }) {
  const trending = useMemo(() => {
    const items = getTrendingItems(8)
    // Ensure we have at least 8 items
    if (items.length < 8) {
      const extra = mediaItems
        .filter((m) => !items.find((i) => i.id === m.id))
        .slice(0, 8 - items.length)
      return [...items, ...extra]
    }
    return items.slice(0, 8)
  }, [])

  return (
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="h2 text-[var(--text-primary)]">Trending Now</h2>
        <span className="live-dot" title="Trending now" />
        <span className="text-[11px] text-[var(--text-tertiary)]">Updated live</span>
      </div>

      <div className="relative">
        <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-[var(--bg-base)] to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[var(--bg-base)] to-transparent z-10 pointer-events-none" />

        <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-2 scroll-snap-x mandatory">
          {trending.map((item, i) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06, duration: 0.4, ease: easeOutExpo }}
              className="shrink-0 w-[240px] md:w-[280px] scroll-snap-align-start cursor-pointer group"
              onClick={() => onSelect(item)}
            >
              <div className="relative aspect-video rounded-[var(--radius-md)] overflow-hidden border border-[var(--border-subtle)] shadow-sm card-lift tile-zoom">
                {/* Thumbnail */}
                <img
                  src={item.thumbnail}
                  alt={item.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />

                {/* Rank badge */}
                <div
                  className={cn(
                    'absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-mono font-bold',
                    i === 0
                      ? 'bg-[var(--accent)] text-white ring-2 ring-[var(--accent)]/50'
                      : 'bg-[var(--bg-overlay)] text-white'
                  )}
                >
                  {i + 1}
                </div>

                {/* Trending pulse */}
                {item.isTrending && (
                  <div className="absolute top-2 right-2">
                    <span className="live-dot" title="Trending now" />
                  </div>
                )}

                {/* Duration */}
                {item.isVideo && item.duration && (
                  <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-sm bg-[var(--bg-overlay)] text-[var(--text-primary)] text-[11px] font-mono">
                    {item.duration}
                  </div>
                )}

                {/* Bottom overlay */}
                <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-[rgba(3,3,5,0.8)] via-[rgba(3,3,5,0.4)] to-transparent">
                  <h4 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-2 leading-snug">
                    {item.title}
                  </h4>
                  <div className="flex items-center gap-1.5 mt-1 text-[11px] text-[var(--text-secondary)]">
                    <Eye size={10} />
                    <span>{formatViews(item.views)}</span>
                    <span>•</span>
                    <span>{timeAgo(item.createdAt)}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────
   Section 3 — Mood Filters
   ──────────────────────────────────────────────── */
const moods = [
  { label: 'Late Night', icon: Moon, color: '#7c3aed', tint: 'rgba(124,58,237,0.15)', border: 'rgba(124,58,237,0.4)' },
  { label: 'Morning', icon: Sunrise, color: '#f59e0b', tint: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.4)' },
  { label: 'Quick Break', icon: Zap, color: '#14b8a6', tint: 'rgba(20,184,166,0.15)', border: 'rgba(20,184,166,0.4)' },
  { label: 'Deep Dive', icon: BookOpen, color: '#3b82f6', tint: 'rgba(59,130,246,0.15)', border: 'rgba(59,130,246,0.4)' },
  { label: 'Discover', icon: Compass, color: 'var(--accent)', tint: 'var(--accent-dim)', border: 'var(--accent-glow)' },
  { label: 'Community Picks', icon: Heart, color: '#e11d48', tint: 'rgba(225,29,72,0.15)', border: 'rgba(225,29,72,0.4)' },
]

function MoodFilters({
  active,
  onChange,
}: {
  active: string | null
  onChange: (mood: string | null) => void
}) {
  return (
    <section className="mb-8">
      <div className="flex items-center justify-center gap-2 flex-wrap">
        {moods.map((mood, i) => {
          const Icon = mood.icon
          const isActive = active === mood.label
          return (
            <motion.button
              key={mood.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.3, ease: easeOutExpo }}
              onClick={() => onChange(isActive ? null : mood.label)}
              className={cn(
                'flex items-center gap-2 h-10 px-4 rounded-full transition-all duration-200 border',
                isActive
                  ? 'border-transparent'
                  : 'border-transparent bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]'
              )}
              style={
                isActive
                  ? {
                      background: mood.tint,
                      borderColor: mood.border,
                      color: mood.color,
                      boxShadow: `0 0 20px ${mood.tint}`,
                    }
                  : undefined
              }
              whileTap={{ scale: 0.95 }}
            >
              <Icon size={14} />
              <span className="text-sm font-medium">{mood.label}</span>
            </motion.button>
          )
        })}
      </div>

      <AnimatePresence>
        {active && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="flex items-center justify-center mt-3"
          >
            <span className="flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)]">
              Mood: {active}
              <button
                onClick={() => onChange(null)}
                className="hover:text-[var(--text-primary)] transition-colors"
                aria-label="Clear mood filter"
              >
                <X size={12} />
              </button>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

/* ────────────────────────────────────────────────
   Section 4 — Featured Categories Grid
   ──────────────────────────────────────────────── */
function CategoryGrid({ onSelectCategory }: { onSelectCategory: (cat: string) => void }) {
  const catImages = useMemo(() => {
    return categories.map((cat, idx) => {
      const items = mediaItems.filter((m) => m.category === cat.name).slice(0, 4)
      return {
        ...cat,
        images: items.map((m) => m.thumbnail),
        seed: 2000 + idx,
      }
    })
  }, [])

  return (
    <section className="mb-8">
      <h2 className="h2 text-[var(--text-primary)] mb-4">Categories</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {catImages.map((cat, i) => (
          <motion.div
            key={cat.id}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ delay: i * 0.06, duration: 0.4, ease: easeOutExpo }}
            className="relative h-[120px] md:h-[160px] rounded-[var(--radius-lg)] overflow-hidden cursor-pointer group border border-[var(--border-subtle)] card-lift tile-zoom"
            onClick={() => onSelectCategory(cat.name)}
          >
            {/* Background image collage or single blurred image */}
            {cat.images.length > 0 ? (
              <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-0.5">
                {cat.images.slice(0, 4).map((img, idx) => (
                  <img
                    key={idx}
                    src={img}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ))}
              </div>
            ) : (
              <div
                className="absolute inset-0 bg-[var(--bg-elevated)]"
                style={{
                  backgroundImage: `url(${seedUrl(cat.seed, 400, 300)})`,
                  backgroundSize: 'cover',
                  filter: 'blur(20px)',
                  transform: 'scale(1.1)',
                }}
              />
            )}

            {/* Dark gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-[rgba(3,3,5,0.9)] via-[rgba(3,3,5,0.3)] to-transparent" />

            {/* NEW badge */}
            {cat.count > 0 && Math.random() > 0.7 && (
              <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded-sm bg-[var(--accent)] text-white text-[10px] font-semibold">
                NEW
              </div>
            )}

            {/* Explore link (hover) */}
            <div className="absolute top-2 right-2 flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-all duration-300 translate-x-0 group-hover:translate-x-0">
              <span>Explore</span>
              <ArrowRight size={10} className="transition-transform group-hover:translate-x-1" />
            </div>

            {/* Bottom text */}
            <div className="absolute bottom-3 left-3 right-3">
              <h3 className="text-base font-semibold text-[var(--text-primary)]">{cat.name}</h3>
              <span className="text-[11px] font-mono text-[var(--text-tertiary)]">{cat.count} items</span>
            </div>

            {/* Border glow on hover */}
            <div className="absolute inset-0 rounded-[var(--radius-lg)] opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(232,121,169,0.3)' }}
            />
          </motion.div>
        ))}
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────
   Section 5 — Creator Spotlight Banner
   ──────────────────────────────────────────────── */
function CreatorSpotlight() {
  const creator = creators[9] // Noah Reed - highest followers
  const previewItems = useMemo(() => {
    return mediaItems
      .filter((m) => m.creator === creator.name)
      .slice(0, 3)
  }, [creator.name])

  const followCache = useAppStore((s) => s.followCache)
  const toggleFollow = useAppStore((s) => s.toggleFollow)
  const isFollowing = followCache[creator.id] ?? false

  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5, ease: easeOutExpo }}
      className="relative w-full min-h-[200px] md:h-[240px] rounded-[var(--radius-lg)] overflow-hidden mb-8 border border-[var(--border-subtle)]"
    >
      {/* Background */}
      <div
        className="absolute inset-0 bg-[var(--bg-elevated)]"
        style={{
          backgroundImage: previewItems[0]
            ? `url(${previewItems[0].thumbnail})`
            : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(40px)',
          transform: 'scale(1.2)',
        }}
      />
      <div className="absolute inset-0 bg-[rgba(3,3,5,0.75)]" />

      {/* Content */}
      <div className="relative z-10 flex flex-col md:flex-row items-center md:items-start gap-4 md:gap-6 p-5 md:p-6">
        {/* Avatar with animated conic gradient ring */}
        <div className="shrink-0">
          <div className="relative w-[80px] h-[80px] md:w-[96px] md:h-[96px]">
            {/* Rotating conic gradient ring */}
            <motion.div
              className="absolute -inset-[3px] rounded-full"
              style={{
                background: 'conic-gradient(from 0deg, var(--accent), var(--accent-hover), var(--accent))',
              }}
              animate={{ rotate: 360 }}
              transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
            />
            <img
              src={creator.avatar}
              alt={creator.name}
              className="relative w-full h-full rounded-full object-cover border-2 border-[var(--bg-base)]"
            />
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 text-center md:text-left">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)]">
            Creator Spotlight
          </span>
          <h2 className="h2 text-[var(--text-primary)] mt-1">{creator.name}</h2>
          <div className="flex items-center justify-center md:justify-start gap-3 mt-1 text-[13px] text-[var(--text-secondary)]">
            <span>12 videos</span>
            <span>•</span>
            <span>{(creator.followers / 1000).toFixed(1)}k followers</span>
            <span>•</span>
            <span>4.9★</span>
          </div>
          <p className="text-[13px] text-[var(--text-secondary)] mt-2 line-clamp-2 max-w-md">
            Award-winning creator known for cinematic storytelling and immersive solo sessions.
          </p>
        </div>

        {/* Actions + Previews */}
        <div className="shrink-0 flex flex-col items-center md:items-end gap-3">
          <div className="flex items-center gap-2">
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => toggleFollow(creator.id)}
              className={cn(
                'px-5 py-2 rounded-full text-sm font-medium transition-colors',
                isFollowing
                  ? 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-medium)]'
                  : 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]'
              )}
            >
              {isFollowing ? 'Following' : 'Follow'}
            </motion.button>
            <button className="px-4 py-2 rounded-full border border-[var(--border-medium)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] transition-colors">
              View Profile
            </button>
          </div>

          {/* Preview thumbnails */}
          <div className="flex items-center gap-2">
            {previewItems.map((item) => (
              <div
                key={item.id}
                className="w-[80px] h-[50px] md:w-[100px] md:h-[60px] rounded-[var(--radius-md)] overflow-hidden border border-[var(--border-subtle)]"
              >
                <img
                  src={item.thumbnail}
                  alt={item.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.section>
  )
}

/* ────────────────────────────────────────────────
   Section 6 — Surprise Me Large CTA
   ──────────────────────────────────────────────── */
function SurpriseMeCTA({ onSurprise }: { onSurprise: () => void }) {
  return (
    <motion.section
      initial={{ opacity: 0, scale: 0.95 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, ease: easeOutExpo }}
      className="flex flex-col items-center py-10 md:py-12 mb-8"
    >
      <motion.button
        onClick={onSurprise}
        className="flex items-center gap-2 px-8 py-3.5 rounded-full bg-[var(--accent)] text-white text-base font-medium hover:bg-[var(--accent-hover)] transition-colors"
        style={{ boxShadow: 'var(--shadow-glow)' }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        animate={{ scale: [1, 1.02, 1] }}
        transition={{ scale: { duration: 3, repeat: Infinity, ease: 'easeInOut' } }}
      >
        <motion.span
          animate={{ rotate: [0, 15, -15, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Sparkles size={20} />
        </motion.span>
        Surprise Me
      </motion.button>
      <p className="text-[13px] text-[var(--text-tertiary)] mt-3">
        Let fate choose your next favorite
      </p>
    </motion.section>
  )
}

/* ────────────────────────────────────────────────
   Section 7 — Recently Popular Vertical List
   ──────────────────────────────────────────────── */
function RecentlyPopular({ onSelect }: { onSelect: (item: MediaItem) => void }) {
  const items = useMemo(() => {
    return [...mediaItems]
      .sort((a, b) => b.views - a.views)
      .slice(0, 10)
  }, [])

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="h2 text-[var(--text-primary)]">Recently Popular</h2>
        <button className="text-[13px] text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors flex items-center gap-1">
          See all <ArrowRight size={14} />
        </button>
      </div>

      <div className="flex flex-col">
        {items.map((item, i) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, x: -12 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-20px' }}
            transition={{ delay: i * 0.04, duration: 0.3, ease: easeOutExpo }}
            className={cn(
              'flex items-center gap-3 h-[80px] px-3 rounded-[var(--radius-md)] cursor-pointer transition-colors hover:bg-[var(--bg-surface)]',
              i % 2 === 0 ? 'bg-transparent' : 'bg-[rgba(255,255,255,0.02)]'
            )}
            onClick={() => onSelect(item)}
          >
            {/* Rank */}
            <span
              className={cn(
                'w-8 text-center text-sm font-bold shrink-0',
                i < 3 ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)]'
              )}
            >
              {i + 1}
            </span>

            {/* Thumbnail */}
            <div className="w-[120px] h-[68px] rounded-[var(--radius-md)] overflow-hidden shrink-0 group/tn">
              <img
                src={item.thumbnail}
                alt={item.title}
                className="w-full h-full object-cover transition-transform duration-300 group-hover/tn:scale-105"
                loading="lazy"
              />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-medium text-[var(--text-primary)] truncate">
                {item.title}
              </h4>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                {item.creator}
              </p>
            </div>

            {/* Right meta */}
            <div className="shrink-0 flex flex-col items-end gap-1">
              <span className="text-[11px] text-[var(--text-tertiary)]">
                {formatViews(item.views)} views
              </span>
              {item.isVideo && item.duration && (
                <span className="px-1.5 py-0.5 rounded-sm bg-[var(--bg-overlay)] text-[var(--text-primary)] text-[10px] font-mono">
                  {item.duration}
                </span>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

/* ────────────────────────────────────────────────
   Surprise Me Overlay
   ──────────────────────────────────────────────── */
function SurpriseOverlay({
  open,
  item,
  onClose,
  onShuffle,
}: {
  open: boolean
  item: MediaItem | null
  onClose: () => void
  onShuffle: () => void
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[300] bg-[var(--bg-overlay)] flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.8, opacity: 0, y: 20 }}
            transition={{ duration: 0.4, ease: easeOutExpo }}
            className="relative w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            {item ? (
              <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] overflow-hidden shadow-lg">
                <div className="relative aspect-[4/5]">
                  <img
                    src={item.thumbnail}
                    alt={item.title}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[rgba(3,3,5,0.8)] to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-5 space-y-3">
                    <h3 className="text-xl font-bold text-[var(--text-primary)]">{item.title}</h3>
                    <p className="text-sm text-[var(--text-secondary)]">
                      {item.creator} • {item.category}
                    </p>
                    <div className="flex items-center gap-2">
                      <button className="btn-primary flex-1">
                        <Play size={16} fill="white" /> Play
                      </button>
                      <button
                        onClick={onShuffle}
                        className="px-4 py-2 rounded-md border border-[var(--border-medium)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] transition-colors"
                      >
                        <Shuffle size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <div className="flex items-center gap-2">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      animate={{ rotate: 360 }}
                      transition={{ duration: 0.8 + i * 0.2, repeat: Infinity, ease: 'linear' }}
                    >
                      <Sparkles size={24} className="text-[var(--accent)]" />
                    </motion.div>
                  ))}
                </div>
                <p className="text-[var(--text-secondary)] text-sm">Shuffling the deck...</p>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ────────────────────────────────────────────────
   Main Explore Page
   ──────────────────────────────────────────────── */
export default function ExplorePage() {
  const [moodFilter, setMoodFilter] = useState<string | null>(null)
  const [showSurprise, setShowSurprise] = useState(false)
  const [surpriseItem, setSurpriseItem] = useState<MediaItem | null>(null)
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const addToast = useAppStore((s) => s.addToast)

  const handleSelectItem = useCallback((item: MediaItem) => {
    setSelectedItem(item)
    setDetailOpen(true)
  }, [])

  const handleCloseDetail = useCallback(() => {
    setDetailOpen(false)
    setTimeout(() => setSelectedItem(null), 400)
  }, [])

  const handleSurprise = useCallback(() => {
    setShowSurprise(true)
    setSurpriseItem(null)
    const candidates = mediaItems
    const random = candidates[Math.floor(Math.random() * candidates.length)]
    setTimeout(() => {
      setSurpriseItem(random)
    }, 800)
  }, [])

  const handleSurpriseClose = useCallback(() => {
    setShowSurprise(false)
    setSurpriseItem(null)
  }, [])

  const handleSurprisePlay = useCallback(() => {
    if (surpriseItem) {
      setSelectedItem(surpriseItem)
      setDetailOpen(true)
      setShowSurprise(false)
    }
  }, [surpriseItem])

  const handleShuffle = useCallback(() => {
    setSurpriseItem(null)
    const candidates = mediaItems
    const random = candidates[Math.floor(Math.random() * candidates.length)]
    setTimeout(() => {
      setSurpriseItem(random)
    }, 600)
  }, [])

  const handleShare = useCallback(() => {
    addToast({ type: 'info', title: 'Link copied to clipboard' })
  }, [addToast])

  return (
    <div className="space-y-2">
      {/* Hero Banner */}
      <ExploreHero />

      {/* Trending Rail */}
      <TrendingRail onSelect={handleSelectItem} />

      {/* Mood Filters */}
      <MoodFilters active={moodFilter} onChange={setMoodFilter} />

      {/* Category Grid */}
      <CategoryGrid
        onSelectCategory={(cat) => {
          addToast({ type: 'info', title: `Navigating to ${cat}` })
        }}
      />

      {/* Creator Spotlight */}
      <CreatorSpotlight />

      {/* Surprise Me CTA */}
      <SurpriseMeCTA onSurprise={handleSurprise} />

      {/* Recently Popular */}
      <RecentlyPopular onSelect={handleSelectItem} />

      {/* Surprise Overlay */}
      <SurpriseOverlay
        open={showSurprise}
        item={surpriseItem}
        onClose={handleSurpriseClose}
        onShuffle={handleShuffle}
      />

      {/* Media Detail Drawer */}
      <MediaDetail
        item={selectedItem}
        open={detailOpen}
        onClose={handleCloseDetail}
        onShare={handleShare}
      />
    </div>
  )
}

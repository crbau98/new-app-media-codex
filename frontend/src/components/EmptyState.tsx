import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import {
  Heart,
  Search,
  FolderOpen,
  CloudOff,
  AlertCircle,
} from 'lucide-react'

type EmptyVariant = 'favorites' | 'search' | 'category' | 'offline' | 'error'

interface EmptyStateProps {
  variant: EmptyVariant
  title?: string
  description?: string
  actionLabel?: string
  onAction?: () => void
}

const config: Record<EmptyVariant, { icon: typeof Heart; defaultTitle: string; defaultDesc: string; defaultAction: string }> = {
  favorites: {
    icon: Heart,
    defaultTitle: 'Nothing here yet',
    defaultDesc: 'Start building your collection by favoriting media you love.',
    defaultAction: 'Browse media',
  },
  search: {
    icon: Search,
    defaultTitle: 'No results found',
    defaultDesc: 'Try different keywords or filters to find what you are looking for.',
    defaultAction: 'Clear filters',
  },
  category: {
    icon: FolderOpen,
    defaultTitle: 'This category is waiting for content',
    defaultDesc: 'Check back later for new additions.',
    defaultAction: 'Browse all',
  },
  offline: {
    icon: CloudOff,
    defaultTitle: 'You are offline',
    defaultDesc: 'Some content may not be available. Reconnect to browse the full library.',
    defaultAction: 'Retry connection',
  },
  error: {
    icon: AlertCircle,
    defaultTitle: 'Something went wrong',
    defaultDesc: 'We could not load this content. Please try again.',
    defaultAction: 'Reload',
  },
}

export default function EmptyState({
  variant,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const c = config[variant]
  const Icon = c.icon

  return (
    <div className="empty-state-panel">
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{
          type: 'spring',
          stiffness: 300,
          damping: 15,
          duration: 0.5,
        }}
        className="w-20 h-20 rounded-full bg-[var(--accent-dim)] flex items-center justify-center"
      >
        <Icon size={32} className="text-[var(--accent)]" />
      </motion.div>

      <motion.h3
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.3 }}
        className="text-lg font-semibold text-[var(--text-primary)]"
      >
        {title ?? c.defaultTitle}
      </motion.h3>

      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.3 }}
        className="text-sm text-[var(--text-secondary)] max-w-xs"
      >
        {description ?? c.defaultDesc}
      </motion.p>

      {onAction && (
        <motion.button
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.3 }}
          onClick={onAction}
          className={cn('btn-primary mt-1')}
        >
          {actionLabel ?? c.defaultAction}
        </motion.button>
      )}
    </div>
  )
}

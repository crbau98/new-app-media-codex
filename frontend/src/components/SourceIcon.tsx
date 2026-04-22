import {
  MessageSquare, FlaskConical, FileText, Twitter,
  MessageCircle, Search, Globe, Flame, Camera, Diamond,
  Image as ImageIcon, Video
} from 'lucide-react'

const ICONS: Record<string, React.FC<{ size?: number; className?: string }>> = {
  reddit:         (p) => <MessageSquare {...p} />,
  pubmed:         (p) => <FlaskConical {...p} />,
  arxiv:          (p) => <FileText {...p} />,
  biorxiv:        (p) => <FileText {...p} />,
  x:              (p) => <Twitter {...p} />,
  twitter:        (p) => <Twitter {...p} />,
  lpsg:           (p) => <MessageCircle {...p} />,
  duckduckgo:     (p) => <Search {...p} />,
  ddg:            (p) => <Search {...p} />,
  web:            (p) => <Globe {...p} />,
  firecrawl:      (p) => <Flame {...p} />,
  visual_capture: (p) => <Camera {...p} />,
  literature:     (p) => <FileText {...p} />,
  coomer:         (p) => <Video {...p} />,
  kemono:         (p) => <ImageIcon {...p} />,
}

export function SourceIcon({ sourceType, size = 12, className }: {
  sourceType: string
  size?: number
  className?: string
}) {
  const Icon = ICONS[sourceType.toLowerCase()]
  if (!Icon) return <Diamond size={size} className={className ?? 'text-text-muted'} />
  return <Icon size={size} className={className ?? 'text-text-muted'} />
}

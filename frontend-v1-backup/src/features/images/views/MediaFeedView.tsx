import { VideoFeed } from "../VideoFeed"

export interface MediaFeedViewProps {
  onExit: () => void
  term?: string | null
  source?: string | null
  feedMediaType?: "video" | "image" | "all"
}

export function MediaFeedView(props: MediaFeedViewProps) {
  return <VideoFeed {...props} />
}

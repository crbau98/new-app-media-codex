export interface MediaItem {
  id: string
  title: string
  thumbnail: string
  mediaUrl?: string
  pageUrl?: string
  source: 'Tube' | 'Redgifs' | 'Imgur' | 'Local' | 'Xtube'
  duration: string
  isVideo: boolean
  category: string
  creator: string
  tags: string[]
  rating: number
  createdAt: string
  views: number
  isNew?: boolean
  isTrending?: boolean
}

export interface Creator {
  id: string
  name: string
  avatar: string
  followers: number
  hasStory: boolean
  storySeen: boolean
}

export interface CategoryDef {
  id: string
  name: string
  count: number
}

function seedUrl(seed: number, width = 400, height = 500): string {
  return `https://picsum.photos/seed/${seed}/${width}/${height}`
}

function videoDuration(): string {
  const mins = Math.floor(Math.random() * 15) + 1
  const secs = Math.floor(Math.random() * 59)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function recentDate(daysAgo = 0): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString()
}

export const creators: Creator[] = [
  { id: 'c1', name: 'Alex Stone', avatar: seedUrl(901, 128, 128), followers: 12400, hasStory: true, storySeen: false },
  { id: 'c2', name: 'Jordan Riley', avatar: seedUrl(902, 128, 128), followers: 8300, hasStory: true, storySeen: true },
  { id: 'c3', name: 'Drew Kane', avatar: seedUrl(903, 128, 128), followers: 5600, hasStory: true, storySeen: false },
  { id: 'c4', name: 'Sam Cruz', avatar: seedUrl(904, 128, 128), followers: 22100, hasStory: true, storySeen: false },
  { id: 'c5', name: 'Mason Fox', avatar: seedUrl(905, 128, 128), followers: 9400, hasStory: false, storySeen: false },
  { id: 'c6', name: 'Logan Blaze', avatar: seedUrl(906, 128, 128), followers: 15700, hasStory: true, storySeen: true },
  { id: 'c7', name: 'Ryan Cole', avatar: seedUrl(907, 128, 128), followers: 7200, hasStory: true, storySeen: false },
  { id: 'c8', name: 'Tyler Nash', avatar: seedUrl(908, 128, 128), followers: 18900, hasStory: false, storySeen: false },
  { id: 'c9', name: 'Ethan Drake', avatar: seedUrl(909, 128, 128), followers: 4500, hasStory: true, storySeen: true },
  { id: 'c10', name: 'Noah Reed', avatar: seedUrl(910, 128, 128), followers: 31200, hasStory: true, storySeen: false },
  { id: 'c11', name: 'Liam Voss', avatar: seedUrl(911, 128, 128), followers: 6700, hasStory: false, storySeen: false },
  { id: 'c12', name: 'Caleb West', avatar: seedUrl(912, 128, 128), followers: 11300, hasStory: true, storySeen: true },
]

const creatorNames = creators.map((c) => c.name)

const categoryNames = [
  'Featured',
  'gay sauna',
  'cum eating gay',
  'ejaculate',
  'gay threesome',
  'hyperspermia',
  'penis',
  'gay solo',
  'gay massage',
]

function makeItem(
  id: number,
  title: string,
  category: string,
  opts: Partial<MediaItem> = {}
): MediaItem {
  const isVideo = opts.isVideo ?? Math.random() > 0.3
  const seed = 1000 + id
  return {
    id: `m${id}`,
    title,
    thumbnail: seedUrl(seed, 400, isVideo ? 500 : 600),
    mediaUrl: opts.mediaUrl,
    pageUrl: opts.pageUrl,
    source: (['Tube', 'Redgifs', 'Imgur', 'Local', 'Xtube'] as const)[
      Math.floor(Math.random() * 5)
    ],
    duration: isVideo ? videoDuration() : '',
    isVideo,
    category,
    creator: creatorNames[Math.floor(Math.random() * creatorNames.length)],
    tags: opts.tags ?? [],
    rating: +(Math.random() * 2 + 3).toFixed(1),
    createdAt: recentDate(Math.floor(Math.random() * 14)),
    views: Math.floor(Math.random() * 50000) + 500,
    isNew: Math.random() > 0.8,
    isTrending: Math.random() > 0.85,
    ...opts,
  }
}

export const mediaItems: MediaItem[] = [
  // Featured
  makeItem(1, 'Midnight Steam Session', 'Featured', { isVideo: true, tags: ['sauna', 'steam', 'hot'], rating: 4.8, views: 42000, isTrending: true }),
  makeItem(2, 'Golden Rain Finale', 'Featured', { isVideo: true, tags: ['cum', 'closeup'], rating: 4.7, views: 38000 }),
  makeItem(3, 'Three in the Locker Room', 'Featured', { isVideo: true, tags: ['threesome', 'locker'], rating: 4.9, views: 55000, isTrending: true }),
  makeItem(4, 'Solo Mirror Play', 'Featured', { isVideo: false, tags: ['solo', 'mirror'], rating: 4.5, views: 21000 }),
  makeItem(5, 'Deep Tissue Release', 'Featured', { isVideo: true, tags: ['massage', 'oil'], rating: 4.6, views: 31000 }),
  makeItem(6, 'Poolside Worship', 'Featured', { isVideo: true, tags: ['outdoor', 'pool'], rating: 4.8, views: 47000 }),

  // gay sauna
  makeItem(7, 'Steam Room Tension', 'gay sauna', { isVideo: true, tags: ['sauna', 'steam'] }),
  makeItem(8, 'Hot Bench Encounter', 'gay sauna', { isVideo: true, tags: ['sauna', 'bench'] }),
  makeItem(9, 'After Hours Sauna', 'gay sauna', { isVideo: true, tags: ['sauna', 'night'] }),
  makeItem(10, 'Finnish Steam Ritual', 'gay sauna', { isVideo: false, tags: ['sauna', 'ritual'] }),
]

export const categories: CategoryDef[] = categoryNames.map((name) => ({
  id: name.toLowerCase().replace(/\s+/g, '-'),
  name,
  count: mediaItems.filter((m) => m.category === name).length,
}))

export function getMediaByCategory(category: string): MediaItem[] {
  return mediaItems.filter((m) => m.category === category)
}

export function getFeaturedItems(count = 3): MediaItem[] {
  return mediaItems.filter((m) => m.category === 'Featured').slice(0, count)
}

export interface MediaItem {
  id: string
  title: string
  thumbnail: string
  source: string
  duration: string
  isVideo: boolean
  category: string
  creator: string
  tags: string[]
  rating: number
  createdAt: string
  views: number
  mediaUrl?: string
  /** Ordered playback fallbacks supplied by the public provider adapter. */
  streamCandidates?: string[]
  pageUrl?: string
  description?: string
  likes?: number
  comments?: number
  isLiked?: boolean
  isNew?: boolean
  isTrending?: boolean
  /** Explainable 0–100 ordering signal based on public engagement and freshness. */
  curationScore?: number
  /** Short, source-derived explanation for why the item is surfaced. */
  curationReasons?: string[]
  /** On-device recommendation score derived from the user's local feedback. */
  personalizedScore?: number
  /** Human-readable explanation of the recommendation. */
  recommendationReasons?: string[]
}

export interface Creator {
  id: string
  name: string
  avatar: string
  followers: number
  hasStory: boolean
  storySeen: boolean
  username?: string
  platform?: string
  profileUrl?: string
  mediaCount?: number
  viewCount?: number
  likeCount?: number
  curationScore?: number
  sourceAttribution?: string
  observedAt?: string
  isWatched?: boolean
  isSimilar?: boolean
  similarityScore?: number
  discoveryReasons?: string[]
  media?: MediaItem[]
}

export interface CategoryDef {
  id: string
  name: string
  count: number
}

/* ────────────────────────────────────────────────
   Image sources: actual male content imagery
   ────────────────────────────────────────────── */

// Unsplash photo IDs for male/fitness imagery (verified working)
const unsplashMalePhotos = [
  'photo-1506794778202-cad84cf45f1d',
  'photo-1566492031773-4f4e44671857',
  'photo-1500648767791-00dcc994a43e',
  'photo-1675557009285-b55f562641b9',
  'photo-1583454110551-21f2fa2afe61',
  'photo-1534438327276-14e5300c3a48',
  'photo-1517836357463-d25dfeac3438',
  'photo-1526506118085-60ce8714f8c5',
  'photo-1581009146145-b5ef050c2e1e',
  'photo-1530822847156-5df684ec5ee1',
  'photo-1599058945522-28d584b6f0ff',
]

function unsplashUrl(photoId: string, width: number, height: number): string {
  return `https://images.unsplash.com/${photoId}?w=${width}&h=${height}&fit=crop&q=80`
}

function creatorAvatarUrl(seed: number): string {
  // placebeard.it shows actual bearded men — reliable, fast, male-focused
  return `https://placebeard.it/128/128/${seed}?grayscale=false`
}

function thumbnailUrl(seed: number, width: number, height: number): string {
  const photoId = unsplashMalePhotos[seed % unsplashMalePhotos.length]
  return unsplashUrl(photoId, width, height)
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
  { id: 'c1', name: 'Alex Stone', avatar: creatorAvatarUrl(1), followers: 12400, hasStory: true, storySeen: false },
  { id: 'c2', name: 'Jordan Riley', avatar: creatorAvatarUrl(2), followers: 8300, hasStory: true, storySeen: true },
  { id: 'c3', name: 'Drew Kane', avatar: creatorAvatarUrl(3), followers: 5600, hasStory: true, storySeen: false },
  { id: 'c4', name: 'Sam Cruz', avatar: creatorAvatarUrl(4), followers: 22100, hasStory: true, storySeen: false },
  { id: 'c5', name: 'Mason Fox', avatar: creatorAvatarUrl(5), followers: 9400, hasStory: false, storySeen: false },
  { id: 'c6', name: 'Logan Blaze', avatar: creatorAvatarUrl(6), followers: 15700, hasStory: true, storySeen: true },
  { id: 'c7', name: 'Ryan Cole', avatar: creatorAvatarUrl(7), followers: 7200, hasStory: true, storySeen: false },
  { id: 'c8', name: 'Tyler Nash', avatar: creatorAvatarUrl(8), followers: 18900, hasStory: false, storySeen: false },
  { id: 'c9', name: 'Ethan Drake', avatar: creatorAvatarUrl(9), followers: 4500, hasStory: true, storySeen: true },
  { id: 'c10', name: 'Noah Reed', avatar: creatorAvatarUrl(10), followers: 31200, hasStory: true, storySeen: false },
  { id: 'c11', name: 'Liam Voss', avatar: creatorAvatarUrl(11), followers: 6700, hasStory: false, storySeen: false },
  { id: 'c12', name: 'Caleb West', avatar: creatorAvatarUrl(12), followers: 11300, hasStory: true, storySeen: true },
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
  const width = 400
  const height = isVideo ? 500 : 600

  return {
    id: `m${id}`,
    title,
    thumbnail: thumbnailUrl(seed, width, height),
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
  makeItem(11, 'Towel Drop Moment', 'gay sauna', { isVideo: true, tags: ['sauna', 'tease'] }),
  makeItem(12, 'Wet Wood Benches', 'gay sauna', { isVideo: true, tags: ['sauna', 'wet'] }),
  makeItem(13, 'Steam and Shadows', 'gay sauna', { isVideo: false, tags: ['sauna', 'artistic'] }),
  makeItem(14, 'Heat Exchange', 'gay sauna', { isVideo: true, tags: ['sauna', 'passion'] }),

  // cum eating gay
  makeItem(15, 'Dripping Chin Closeup', 'cum eating gay', { isVideo: true, tags: ['cum', 'closeup'] }),
  makeItem(16, 'Swallow Session', 'cum eating gay', { isVideo: true, tags: ['cum', 'swallow'] }),
  makeItem(17, 'Tongue Collection', 'cum eating gay', { isVideo: false, tags: ['cum', 'tongue'] }),
  makeItem(18, 'Feeding Frenzy', 'cum eating gay', { isVideo: true, tags: ['cum', 'group'] }),
  makeItem(19, 'Drizzle and Lick', 'cum eating gay', { isVideo: true, tags: ['cum', 'lick'] }),
  makeItem(20, 'Messy Finale', 'cum eating gay', { isVideo: true, tags: ['cum', 'messy'] }),
  makeItem(21, 'Drop by Drop', 'cum eating gay', { isVideo: false, tags: ['cum', 'artistic'] }),
  makeItem(22, 'Clean Up Duty', 'cum eating gay', { isVideo: true, tags: ['cum', 'clean'] }),

  // ejaculate
  makeItem(23, 'High Pressure Release', 'ejaculate', { isVideo: true, tags: ['cum', 'pressure'] }),
  makeItem(24, 'Fountain Shot', 'ejaculate', { isVideo: true, tags: ['cum', 'fountain'] }),
  makeItem(25, 'Slow Motion Burst', 'ejaculate', { isVideo: true, tags: ['cum', 'slowmo'] }),
  makeItem(26, 'Double Stream', 'ejaculate', { isVideo: false, tags: ['cum', 'double'] }),
  makeItem(27, 'Arc Shot', 'ejaculate', { isVideo: true, tags: ['cum', 'arc'] }),
  makeItem(28, 'Power Load', 'ejaculate', { isVideo: true, tags: ['cum', 'power'] }),
  makeItem(29, 'Drip Trail', 'ejaculate', { isVideo: false, tags: ['cum', 'trail'] }),
  makeItem(30, 'Volcano Eruption', 'ejaculate', { isVideo: true, tags: ['cum', 'eruption'] }),

  // gay threesome
  makeItem(31, 'Triangle of Pleasure', 'gay threesome', { isVideo: true, tags: ['threesome', 'triangle'] }),
  makeItem(32, 'Tag Team Massage', 'gay threesome', { isVideo: true, tags: ['threesome', 'massage'] }),
  makeItem(33, 'Three-Way Kiss', 'gay threesome', { isVideo: false, tags: ['threesome', 'kiss'] }),
  makeItem(34, 'Spin the Bottom', 'gay threesome', { isVideo: true, tags: ['threesome', 'spin'] }),
  makeItem(35, 'Oil Slick Trio', 'gay threesome', { isVideo: true, tags: ['threesome', 'oil'] }),
  makeItem(36, 'Mirror Reflections', 'gay threesome', { isVideo: true, tags: ['threesome', 'mirror'] }),
  makeItem(37, 'Chain Reaction', 'gay threesome', { isVideo: true, tags: ['threesome', 'chain'] }),
  makeItem(38, 'Midnight Train', 'gay threesome', { isVideo: true, tags: ['threesome', 'train'] }),

  // hyperspermia
  makeItem(39, 'Overflow Bowl', 'hyperspermia', { isVideo: true, tags: ['hyper', 'volume'] }),
  makeItem(40, 'Endless Stream', 'hyperspermia', { isVideo: true, tags: ['hyper', 'stream'] }),
  makeItem(41, 'Soaked Sheets', 'hyperspermia', { isVideo: true, tags: ['hyper', 'wet'] }),
  makeItem(42, 'Fill the Cup', 'hyperspermia', { isVideo: false, tags: ['hyper', 'cup'] }),
  makeItem(43, 'Milking Machine', 'hyperspermia', { isVideo: true, tags: ['hyper', 'machine'] }),
  makeItem(44, 'Gush and Flow', 'hyperspermia', { isVideo: true, tags: ['hyper', 'flow'] }),

  // penis
  makeItem(45, 'Morning Glory', 'penis', { isVideo: false, tags: ['cock', 'morning'] }),
  makeItem(46, 'Vein Mapping', 'penis', { isVideo: false, tags: ['cock', 'veins'] }),
  makeItem(47, 'Growth Timelapse', 'penis', { isVideo: true, tags: ['cock', 'grow'] }),
  makeItem(48, 'Head Closeup', 'penis', { isVideo: false, tags: ['cock', 'closeup'] }),
  makeItem(49, 'Shaft Study', 'penis', { isVideo: true, tags: ['cock', 'study'] }),
  makeItem(50, 'Uncut Reveal', 'penis', { isVideo: true, tags: ['cock', 'uncut'] }),
  makeItem(51, 'Shadow Play', 'penis', { isVideo: false, tags: ['cock', 'shadow'] }),
  makeItem(52, 'Drip at the Tip', 'penis', { isVideo: true, tags: ['cock', 'precum'] }),

  // gay solo
  makeItem(53, 'Bedroom Mirror', 'gay solo', { isVideo: true, tags: ['solo', 'mirror'] }),
  makeItem(54, 'Shower Steam', 'gay solo', { isVideo: true, tags: ['solo', 'shower'] }),
  makeItem(55, 'Window Light', 'gay solo', { isVideo: false, tags: ['solo', 'light'] }),
  makeItem(56, 'Edging Session', 'gay solo', { isVideo: true, tags: ['solo', 'edge'] }),
  makeItem(57, 'Couch Spread', 'gay solo', { isVideo: true, tags: ['solo', 'couch'] }),
  makeItem(58, 'Late Night Stroke', 'gay solo', { isVideo: true, tags: ['solo', 'night'] }),
  makeItem(59, 'Outdoor Streak', 'gay solo', { isVideo: false, tags: ['solo', 'outdoor'] }),
  makeItem(60, 'Oil and Skin', 'gay solo', { isVideo: true, tags: ['solo', 'oil'] }),

  // gay massage
  makeItem(61, 'Warm Oil Rub', 'gay massage', { isVideo: true, tags: ['massage', 'oil'] }),
  makeItem(62, 'Deep Tissue Touch', 'gay massage', { isVideo: true, tags: ['massage', 'deep'] }),
  makeItem(63, 'Table Tension', 'gay massage', { isVideo: true, tags: ['massage', 'table'] }),
  makeItem(64, 'Four Hands Flow', 'gay massage', { isVideo: true, tags: ['massage', 'fourhands'] }),
  makeItem(65, 'Hot Stone Trail', 'gay massage', { isVideo: false, tags: ['massage', 'stones'] }),
  makeItem(66, 'Sensory Release', 'gay massage', { isVideo: true, tags: ['massage', 'sensory'] }),
  makeItem(67, 'Back Arch', 'gay massage', { isVideo: true, tags: ['massage', 'back'] }),
  makeItem(68, 'Happy Ending', 'gay massage', { isVideo: true, tags: ['massage', 'finish'] }),
]

export const categories: CategoryDef[] = categoryNames.map((name) => ({
  id: name.toLowerCase().replace(/\s+/g, '-'),
  name,
  count: mediaItems.filter((m) => m.category === name).length,
}))

export function getMediaByCategory(category: string): MediaItem[] {
  return mediaItems.filter((m) => m.category === category)
}

export function getTrendingItems(count = 6): MediaItem[] {
  return mediaItems
    .filter((m) => m.isTrending)
    .sort(() => Math.random() - 0.5)
    .slice(0, count)
}

export function getFeaturedItems(count = 3): MediaItem[] {
  return getMediaByCategory('Featured').slice(0, count)
}

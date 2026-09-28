/**
 * zod contracts for the AI edge endpoints. Leaf module (only depends on zod)
 * so it is unit-testable with `node --test`.
 */

import { z } from 'zod'

export const MOOD_VALUES = ['chill', 'energetic', 'romantic', 'playful', 'marathon'] as const
export const SORT_VALUES = ['relevance', 'newest', 'oldest', 'popular', 'shortest', 'longest', 'random'] as const

/** What the model may return when refining a natural-language query. */
export const refinementSchema = z.object({
  text: z.string().max(120).nullable(),
  tags: z.array(z.string().max(30)).max(8),
  excludeTags: z.array(z.string().max(30)).max(6),
  creators: z.array(z.string().max(40)).max(4),
  sources: z.array(z.string().max(30)).max(4),
  moods: z.array(z.enum(MOOD_VALUES)).max(3),
  mediaType: z.enum(['video', 'image']).nullable(),
  minDurationSec: z.number().min(0).max(86_400).nullable(),
  maxDurationSec: z.number().min(0).max(86_400).nullable(),
  sinceDays: z.number().min(0).max(3650).nullable(),
  sort: z.enum(SORT_VALUES).nullable(),
  summary: z.string().max(140).nullable(),
})
export type Refinement = z.infer<typeof refinementSchema>

export const queryRequestSchema = z.object({
  query: z.string().min(1).max(400),
  vocab: z.object({
    tags: z.array(z.string().max(40)).max(80).default([]),
    creators: z.array(z.string().max(60)).max(40).default([]),
    sources: z.array(z.string().max(30)).max(12).default([]),
  }).default({ tags: [], creators: [], sources: [] }),
})

export const catalogItemSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().max(300).default(''),
  creator: z.string().max(120).default(''),
  source: z.string().max(60).default(''),
  tags: z.array(z.string().max(60)).max(20).default([]),
  duration: z.number().min(0).max(864_000).default(0),
  isVideo: z.boolean().default(true),
  views: z.number().min(0).default(0),
  likes: z.number().min(0).default(0),
  createdAt: z.string().max(40).default(''),
})

export const conciergeRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(2000),
  })).min(1).max(14),
  catalog: z.array(catalogItemSchema).max(150).default([]),
  context: z.object({
    currentId: z.string().max(120).nullable().optional(),
    /** Opt-in only: a handful of tag names the user likes. Never raw history. */
    tasteTags: z.array(z.string().max(40)).max(6).optional(),
  }).optional(),
})
export type ConciergeRequest = z.infer<typeof conciergeRequestSchema>

/** Every tool returns ids that must exist in the client-supplied catalog. */
export const toolResultSchema = z.object({
  ids: z.array(z.string().max(120)).max(30),
  note: z.string().max(400).default(''),
  reasons: z.record(z.string(), z.string().max(160)).default({}),
  name: z.string().max(80).optional(),
  totalSeconds: z.number().optional(),
})
export type ToolResult = z.infer<typeof toolResultSchema>

export const embedRequestSchema = z.object({
  texts: z.array(z.string().min(1).max(400)).min(1).max(64),
})

---
name: premium-media-web-design
description: Designs and implements premium media websites and web apps with Apple.com–level polish—editorial typography, restrained motion, product-led imagery, and high-end marketing craft. Use when building or refining landing pages, marketing sites, media players, content libraries, or brand-forward UIs where the user wants luxury/minimal clarity, “Apple-like” feel, or references to top-tier consumer sites.
---

# Premium media web design (Apple-inspired)

## When this applies

Use this skill when the user asks for:

- Apple.com–style or “high-end” marketing / product storytelling
- Media apps: browse, discover, play, continue watching, editorial rails
- A site or app that should feel **crafted**, not template-driven

If the task is generic UI with no premium/media direction, prefer the project stack and normal patterns; still borrow **restraint and hierarchy** from below.

## Core philosophy

1. **Clarity over decoration** — One primary action per view; secondary actions recede. No competing hero messages.
2. **Typography does the work** — Large, confident headlines; comfortable reading measure for body; clear scale steps (display → title → body → caption).
3. **Whitespace as a material** — Generous padding, predictable vertical rhythm, breathing room around heroes and media.
4. **Imagery and media first** — Photography and video are heroes; UI chrome stays thin (subtle borders, soft separators, glass only when it earns its place).
5. **Motion is subtle** — Short durations, ease curves that feel physical (`cubic-bezier` refinements), staggered reveals on load; avoid carnival animations.

## Visual system

### Typography

- Pair a **neutral, highly legible** sans for UI and long text with an optional **display** face for hero/editorial moments—or stay single-family with weight contrast only.
- Avoid overused “AI default” stacks when a distinctive choice fits the brand; still prioritize **readability** for media titles and metadata.
- Use tracking adjustments on uppercase labels; avoid all-caps paragraphs.

### Color

- Prefer **near-black / near-white** foundations with one or two accent colors used sparingly for CTAs and focus.
- Define tokens (`--background`, `--foreground`, `--muted`, `--accent`, `--border`) and reuse; avoid rainbow gradients unless the brand demands it.

### Layout

- Strong **12-column grid** or fluid max-width container (`max-w-*` + horizontal padding).
- **Full-bleed** sections for heroes and featured media; constrain text blocks for readability (`prose` or `max-w-prose`).
- Use **bento-style** or card grids for discovery; keep card chrome minimal (radius + soft shadow or hairline border).

### Imagery and media

- Large **aspect-ratio** frames for posters/thumbnails; consistent ratios across rails.
- Reserve **blur/placement** for skeletons; prefer crisp art with `object-fit: cover` and defined corners.
- For video/audio: clear **play/pause**, scrubber, time, and volume; large hit targets; keyboard support.

## Patterns for media products

| Pattern | Direction |
|--------|-------------|
| Hero | Single headline, one subcopy line, one primary CTA, optional background video or still—no clutter |
| Discovery | Rows with clear section titles; horizontal scroll on mobile with snap; “See all” as quiet link |
| Detail | Artwork dominant; title, meta, actions in a clear vertical order; related content below the fold |
| Empty / loading | Calm copy, single CTA; skeletons that match final layout |

## Motion checklist

- Page/section enter: opacity + slight translate (4–12px), stagger children by 30–80ms.
- Hover: subtle lift or border/opacity shift; respect `prefers-reduced-motion`.
- Do not animate large layout properties every frame; prefer `transform` and `opacity`.

## Technical expectations

- Semantic regions (`header`, `main`, `nav`, `section`, `article`) and heading order.
- Focus states visible and on-brand; color contrast for text on images (scrims/gradients when needed).
- Performance: prioritize **LCP** (hero image/video poster), lazy-load off-screen media, responsive `srcset`/`sizes` where applicable.

## Anti-patterns (this aesthetic)

- Purple/indigo gradient on white “startup template” look
- Dense dashboards disguised as marketing pages
- Five equal-weight CTAs above the fold
- Stock icon sets as the main visual language
- Parallax or motion that obscures content or hurts accessibility

## Workflow

1. Confirm **audience**, **primary action**, and **brand constraints** (if any).
2. Lock **type scale**, **spacing rhythm**, and **color tokens** before building many screens.
3. Build **one hero + one discovery row** first; refine until it feels “finished,” then scale.

## Related guidance

For general “avoid generic AI UI” and bold aesthetic direction across projects, team practices may also use a broader frontend-design skill if present—this skill adds **media- and Apple-grade product storytelling** specifics on top.

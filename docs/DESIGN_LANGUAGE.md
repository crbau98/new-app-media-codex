# Design language — "Midnight Velvet"

Upscale, cinematic, after-dark. Deep aubergine-black surfaces, warm ivory ink,
champagne-gold hairlines, and a restrained pride-spectrum used only as thin
light (gradients on borders, glows, progress, focus) — never as flat fills.

## Rules every workstream follows
- Tailwind semantic tokens only (`bg-canvas`, `text-ink`, `text-ink-2`, `text-heat`, `border-line`).
  The token *values* live in `src/index.css`; only the design-chrome owner edits them.
- Rich motion (3D, parallax, WebGL, springs) must be gated by `useMotionOk()` and degrade to a
  static, still-beautiful layout. Touch devices get no hover-tilt.
- Every 3D/WebGL surface: lazy-loaded, `aria-hidden`, pointer-events none unless interactive,
  paused when offscreen (IntersectionObserver) or tab hidden.
- Tap targets ≥ 44px, safe-area insets respected, 16px inputs (iOS zoom).
- Perf budget (`npm run build:budget`): ≤200 kB gz per JS chunk, ≤475 kB gz total JS, ≤30 kB gz CSS.
- Shared primitives: `components/three/Tilt3D` (pointer tilt+glare), `hooks/useMotionOk`.
- Copy: confident, warm, adult, never crude in UI chrome. Content is adults-only, consent/rights aware.

# AI-assisted immersive web workflow

This is the production workflow for evolving Media Codex into an agency-quality immersive product. AI accelerates breadth and iteration; people retain authorship over art direction, accessibility, licensing, privacy, and release decisions.

## 1. Concept and product truth

Start with the product state, not a decorative effect. The selected concept is **Signal Constellation**: source activity, scans, creator relationships, and freshness form a spatial discovery observatory. Media itself remains in fast, readable cards.

Use image generation for non-explicit moodboards across three axes: nocturne editorial design, orbital information systems, and smoked-glass material studies. Score directions for distinctiveness, legibility, technical feasibility, and respectful presentation. A design lead selects one direction and records the rationale.

AI acceleration: moodboard breadth, naming, palette variations, competitive pattern summaries. Human gate: brand choice, consent context, sensitive-content presentation, originality review.

## 2. UI creation

Generate multiple low-fidelity compositions, then rebuild the chosen hierarchy with the existing React components and design tokens. Every spatial visualization needs equivalent semantic HTML: headings, status, recommendation reasons, buttons, and creator records.

The motion vocabulary is small and functional:

- Discover: pulse
- Relate: connect
- Inspect: focus
- Enter: converge
- Leave: dissolve

AI acceleration: component scaffolds, token variants, responsive edge-case matrices, microcopy alternatives. Human gate: hierarchy, readability, keyboard path, mobile ergonomics.

## 3. 3D asset generation

Prototype interactions with CSS 3D and simple procedural geometry before commissioning a GLB. For a production asset, use generated abstract concept art only; recreate it in Blender with clean topology and known licensing.

Asset pipeline:

1. Model primitives or Geometry Nodes in Blender.
2. Remove hidden geometry and merge compatible materials.
3. Produce desktop and mobile LODs.
4. Bake lighting where possible and pack ORM channels.
5. Convert textures to KTX2/Basis with mipmaps.
6. Compress geometry with Meshopt.
7. Export a safe static AVIF/WebP poster.
8. Inspect every asset in CI before release.

AI acceleration: Blender scripts, material exploration, LOD helpers, texture concepts. Human gate: topology, UVs, licensing, visual artifacts, file budgets.

## 4. Coding and animation

The current CSS 3D scene is deliberately dependency-free and lazy-loaded. If WebGL later adds meaningful utility, keep Three.js in a route-level async chunk and render the poster first. The canvas is decorative, never the only interaction surface.

Map animation to real state: connected sources glow, scans pulse, AI matches connect, degraded sources dim. Stop work when offscreen or hidden. Never set React state per frame; mutate scene refs and use demand rendering.

AI acceleration: typed provider adapters, shader prototypes, test generation, cleanup checklists. Human gate: lifecycle correctness, device behavior, fallback quality, data-to-motion semantics.

## 5. Testing and optimization

Each release passes:

- Lint, TypeScript, production build, and bundle budgets
- Keyboard and screen-reader-equivalent DOM controls
- Reduced-motion, Data Saver, low-core, and offscreen behavior
- Chromium, Firefox, WebKit, and representative mobile viewports
- Media poster and byte-range streaming checks
- No layout shift when enhancement loads
- Visual regression for the adult gate, hero, creator radar, and playback modal

AI acceleration: Playwright generation, trace summaries, visual-diff triage. Human gate: actual-device feel, false-positive recommendations, consent and privacy review.

## 6. Deployment and maintenance

Ship through a preview PR. Verify the preview, merge only on green, and repeat the critical flow on production. Record Core Web Vitals by route and capability tier. Roll back when the fallback is worse than the previous stable experience.

Maintain a monthly asset and dependency audit, a quarterly accessibility review, and a budget review whenever a new visual system or provider is added. Generated assets retain prompt, source, license, editor, and approval metadata.

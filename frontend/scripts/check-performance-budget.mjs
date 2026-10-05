import { gzipSync } from 'node:zlib'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../dist/', import.meta.url))
const files = []

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await walk(path)
    else files.push(path)
  }
}

await walk(root)

const assets = await Promise.all(files
  .filter((file) => /\.(js|css)$/.test(file))
  .map(async (file) => {
    const body = await readFile(file)
    return { file: relative(root, file).replaceAll('\\', '/'), type: file.endsWith('.css') ? 'css' : 'js', raw: body.byteLength, gzip: gzipSync(body).byteLength }
  }))
const bySize = new Map(assets.map((asset) => [asset.file, asset]))

// Hard stops (bytes, gzip). docs/PERFORMANCE_FRAMEWORK.md has the targets behind them.
const limits = {
  /** Largest single chunk: today the lazy hls.js engine (~118 kB). */
  maxJavaScriptChunkGzip: 125_000,
  totalJavaScriptGzip: 440_000,
  totalCssGzip: 26_000,
  /** Everything the first paint needs: entry + static imports (+ boot script) — doc hard stop 200 kB, target 180 kB. */
  initialJavaScriptGzip: 200_000,
  initialCssGzip: 24_000,
  /** Initial + the route's own lazy chunks (what a cold landing on that route downloads for JS/CSS). */
  routeJavaScriptGzip: 225_000,
  /** Creators statically imports the player sheet (MediaDetail + CreatorDrawer): follow-up is to lazy-load them there. */
  routeJavaScriptGzipOverrides: { '/creators': 245_000 },
  routeCssGzip: 26_000,
}
const targets = { initialJavaScriptGzip: 180_000, initialCssGzip: 25_000 }

const js = assets.filter((asset) => asset.type === 'js')
const css = assets.filter((asset) => asset.type === 'css')
const sum = (list) => list.reduce((total, asset) => total + asset.gzip, 0)
const failures = [
  ...js.filter((asset) => asset.gzip > limits.maxJavaScriptChunkGzip).map((asset) => `${asset.file} is ${asset.gzip} B gzip (limit ${limits.maxJavaScriptChunkGzip} B)`),
  ...(sum(js) > limits.totalJavaScriptGzip ? [`Total JavaScript gzip ${sum(js)} B exceeds ${limits.totalJavaScriptGzip} B`] : []),
  ...(sum(css) > limits.totalCssGzip ? [`Total CSS gzip ${sum(css)} B exceeds ${limits.totalCssGzip} B`] : []),
]
const warnings = []

/* ── Per-route budgets (needs the Vite manifest: build.manifest = true) ── */
const manifestPath = join(root, '.vite/manifest.json')
const rows = []
if (!existsSync(manifestPath)) {
  failures.push('dist/.vite/manifest.json is missing: per-route budgets cannot be checked (vite.config.ts must set build.manifest)')
} else {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

  /** Static-import closure of a manifest key: JS files and CSS files. */
  function closure(key, seen = new Set(), out = { js: new Set(), css: new Set() }) {
    if (seen.has(key)) return out
    seen.add(key)
    const chunk = manifest[key]
    if (!chunk) return out
    out.js.add(chunk.file)
    for (const stylesheet of chunk.css ?? []) out.css.add(stylesheet)
    for (const imported of chunk.imports ?? []) closure(imported, seen, out)
    return out
  }
  const merge = (...parts) => ({ js: new Set(parts.flatMap((part) => [...part.js])), css: new Set(parts.flatMap((part) => [...part.css])) })
  const total = (set) => [...set].reduce((bytes, file) => bytes + (bySize.get(file)?.gzip ?? 0), 0)

  const entryKey = Object.entries(manifest).find(([, chunk]) => chunk.isEntry)?.[0]
  if (!entryKey) {
    failures.push('No entry chunk found in the Vite manifest')
  } else {
    const initial = closure(entryKey)
    // The boot script is a plain asset injected by vite.config.ts (not part of the module graph).
    const boot = assets.find((asset) => /^assets\/boot-[\w-]+\.js$/.test(asset.file))
    const initialJs = total(initial.js) + (boot?.gzip ?? 0)
    const initialCss = total(initial.css)
    rows.push({ scope: 'initial (first paint)', jsGzip: initialJs, cssGzip: initialCss, files: initial.js.size + (boot ? 1 : 0) })
    if (initialJs > limits.initialJavaScriptGzip) failures.push(`Initial JavaScript is ${initialJs} B gzip (hard stop ${limits.initialJavaScriptGzip} B)`)
    else if (initialJs > targets.initialJavaScriptGzip) warnings.push(`Initial JavaScript ${initialJs} B gzip is above the ${targets.initialJavaScriptGzip} B target`)
    if (initialCss > limits.initialCssGzip) failures.push(`Initial CSS is ${initialCss} B gzip (hard stop ${limits.initialCssGzip} B)`)
    else if (initialCss > targets.initialCssGzip) warnings.push(`Initial CSS ${initialCss} B gzip is above the ${targets.initialCssGzip} B target`)

    const routes = {
      '/media (Home)': ['src/pages/home/HomeBody.tsx'],
      '/explore': ['src/pages/Explore.tsx'],
      '/search': ['src/pages/Search.tsx'],
      '/creators': ['src/pages/Creators.tsx'],
      '/settings': ['src/pages/Settings.tsx'],
    }
    for (const [route, keys] of Object.entries(routes)) {
      const present = keys.filter((key) => manifest[key])
      if (!present.length) {
        failures.push(`Route ${route}: ${keys.join(', ')} not found in the manifest (budget script needs updating)`)
        continue
      }
      const all = merge(initial, ...present.map((key) => closure(key)))
      const routeJs = total(all.js) + (boot?.gzip ?? 0)
      const routeCss = total(all.css)
      rows.push({ scope: route, jsGzip: routeJs, cssGzip: routeCss, files: all.js.size + (boot ? 1 : 0) })
      const routeLimit = limits.routeJavaScriptGzipOverrides[route] ?? limits.routeJavaScriptGzip
      if (routeJs > routeLimit) failures.push(`Route ${route}: JavaScript ${routeJs} B gzip exceeds ${routeLimit} B`)
      if (routeCss > limits.routeCssGzip) failures.push(`Route ${route}: CSS ${routeCss} B gzip exceeds ${limits.routeCssGzip} B`)
    }
  }
}

console.table(assets.filter((asset) => !asset.file.startsWith('sw.js')).sort((a, b) => b.gzip - a.gzip).slice(0, 14))
if (rows.length) {
  console.log('\nGzip bytes a cold landing downloads (JS/CSS; excludes images, fonts and lazily opened sheets such as the player):')
  console.table(rows)
}
console.log(`Totals: JS ${sum(js)} B / ${limits.totalJavaScriptGzip} B, CSS ${sum(css)} B / ${limits.totalCssGzip} B, largest chunk ${Math.max(...js.map((asset) => asset.gzip))} B / ${limits.maxJavaScriptChunkGzip} B`)
for (const warning of warnings) console.warn(`warn: ${warning}`)
if (failures.length) {
  console.error('\nPerformance budget failed:\n- ' + failures.join('\n- '))
  process.exitCode = 1
} else {
  console.log('\nPerformance budget passed.')
}

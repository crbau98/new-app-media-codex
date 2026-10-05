import path from 'path'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig, transformWithEsbuild, type Plugin } from 'vite'
import { inspectAttr } from 'plugin-inspect-react-code'

/**
 * Ships src/lib/perf/boot.js (theme + early feed request + hero poster preload)
 * as a fingerprinted same-origin script injected first in <head>.
 *
 * It is NOT inlined on purpose: the production CSP is `script-src 'self'`, so an
 * inline <script> is blocked. In dev (no CSP) it is inlined for fast refresh.
 */
function bootScript(): Plugin {
  const file = path.resolve(__dirname, 'src/lib/perf/boot.js')
  let serving = false
  let code = ''
  let fileName = ''
  return {
    name: 'media-codex:boot-script',
    configResolved(config) {
      serving = config.command === 'serve'
    },
    async buildStart() {
      const source = readFileSync(file, 'utf8')
      if (serving) {
        code = source
        return
      }
      code = (await transformWithEsbuild(source, file, { minify: true, target: 'es2019' })).code
      fileName = `assets/boot-${createHash('sha256').update(code).digest('hex').slice(0, 8)}.js`
    },
    generateBundle() {
      if (!serving) this.emitFile({ type: 'asset', fileName, source: code })
    },
    transformIndexHtml: {
      order: 'post',
      handler() {
        return serving
          ? [{ tag: 'script', children: code, injectTo: 'head-prepend' as const }]
          : [{ tag: 'script', attrs: { src: `/${fileName}` }, injectTo: 'head-prepend' as const }]
      },
    },
  }
}

/**
 * Vendor chunking: the two biggest, rarely-changing libraries (React, Framer Motion: ~100 kB of the
 * ~195 kB initial gzip) get their own long-lived chunks, so an app deploy no longer invalidates them
 * for returning visitors and the browser stream-parses them in parallel. Smaller libraries are left
 * in the entry on purpose: splitting router/query/icons as well cost +5 kB gzip of initial transfer
 * for no caching benefit. hls.js is deliberately NOT listed: it stays behind the player's dynamic import.
 */
function vendorChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined
  const match = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(id.replace(/\\/g, '/'))
  switch (match?.[1]) {
    case 'react':
    case 'react-dom':
    case 'scheduler':
      return 'vendor-react'
    case 'framer-motion':
    case 'motion-dom':
    case 'motion-utils':
      return 'vendor-motion'
    default:
      return undefined
  }
}

// https://vite.dev/config/
// The code-inspection plugin is dev-only: it must never ship in prod bundles.
export default defineConfig(({ mode }) => ({
  base: '/',
  plugins: [react(), bootScript(), ...(mode === 'development' ? [inspectAttr()] : [])],
  build: {
    // Safari 15+/Chrome 100+ all support modulepreload natively; the polyfill is dead weight.
    modulePreload: { polyfill: false },
    reportCompressedSize: false,
    // Lets scripts/check-performance-budget.mjs compute per-route JS/CSS from the real module graph.
    manifest: true,
    rollupOptions: {
      output: { manualChunks: vendorChunk },
    },
  },
  server: {
    port: 3000,
    proxy: {
      // Match the Vercel gateway path during local development.
      '/api/render': {
        target: process.env.RENDER_BACKEND_ORIGIN || 'https://codex-research-radar.onrender.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/render/, ''),
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
}))

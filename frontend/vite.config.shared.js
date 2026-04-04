import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

const backendTarget = process.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000'
const wsTarget = backendTarget.replace(/^http/, 'ws')

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  server: {
    proxy: {
      '/api': backendTarget,
      '/ws': { target: wsTarget, ws: true },
      '/healthz': backendTarget,
      '/cached-images': backendTarget,
      '/cached-screenshots': backendTarget,
      '/cached-previews': backendTarget,
    },
  },
  build: {
    outDir: '../app/static/dist',
    emptyOutDir: true,
    target: 'es2020',
    cssMinify: 'lightningcss',
    modulePreload: {
      polyfill: false,
    },
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          // Core React - always needed, cache forever
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) return 'vendor-react'
          // Heavy charting libs - loaded lazily
          if (id.includes('/recharts/') || id.includes('/d3-') || id.includes('/d3/')) return 'vendor-charts'
          // State + query - small but critical
          if (id.includes('@tanstack/react-query') || id.includes('/zustand/')) return 'vendor-state'
          // Icons - large but tree-shaken
          if (id.includes('/lucide-react/')) return 'vendor-icons'
          // Everything else from node_modules into one shared vendor chunk
          return 'vendor-shared'
        },
      },
    },
  },
})
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

const backendTarget = process.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000'
const wsTarget = backendTarget.replace(/^http/, 'ws')

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  server: {
    proxy: {
      '/api': backendTarget,
      '/ws': { target: wsTarget, ws: true },
      '/healthz': backendTarget,
      '/cached-images': backendTarget,
      '/cached-screenshots': backendTarget,
      '/cached-previews': backendTarget,
    },
  },
  build: {
    outDir: '../app/static/dist',
    emptyOutDir: true,
    target: 'es2020',
    cssMinify: 'lightningcss',
    modulePreload: {
      polyfill: false,
    },
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          // Core React â always needed, cache forever
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) return 'vendor-react'
          // Heavy charting libs â loaded lazily
          if (id.includes('/recharts/') || id.includes('/d3-') || id.includes('/d3/')) return 'vendor-charts'
          // State + query â small but critical
          if (id.includes('@tanstack/react-query') || id.includes('/zustand/')) return 'vendor-state'
          // Icons â large but tree-shaken
          if (id.includes('/lucide-react/')) return 'vendor-icons'
          // Everything else from node_modules into one shared vendor chunk
          return 'vendor-shared'
        },
      },
    },
  },
})
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

const backendTarget = process.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000'
const wsTarget = backendTarget.replace(/^http/, 'ws')

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  server: {
    proxy: {
      '/api': backendTarget,
      '/ws': { target: wsTarget, ws: true },
      '/cached-images': backendTarget,
      '/cached-screenshots': backendTarget,
      '/cached-previews': backendTarget,
    },
  },
  build: {
    outDir: '../app/static/dist',
    emptyOutDir: true,
    target: 'es2020',
    modulePreload: {
      polyfill: false,
    },
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          // Keep small shared utils out of heavy vendor chunks
          if (id.includes('/clsx/') || id.includes('/tailwind-merge/')) return 'vendor-utils'
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) return 'vendor-react'
          if (id.includes('@tanstack/react-query')) return 'vendor-query'
          if (id.includes('/recharts/')) return 'vendor-recharts'
          if (id.includes('/d3-') || id.includes('/d3/')) return 'vendor-d3'
          if (id.includes('/lucide-react/')) return 'vendor-icons'
          if (id.includes('/dompurify/')) return 'vendor-sanitize'
          if (id.includes('/zustand/')) return 'vendor-state'
          return undefined
        },
      },
    },
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { resolve } from 'path'

const backendTarget = process.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000'
const wsTarget = backendTarget.replace(/^http/, 'ws')

export default defineConfig({
  plugins: [react()],
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
          if (id.includes('@tanstack/react-query')) return 'vendor-query'
          if (id.includes('/recharts/')) return 'vendor-recharts'
          if (id.includes('/d3-') || id.includes('/d3/')) return 'vendor-d3'
          if (id.includes('/lucide-react/')) return 'vendor-icons'
          if (id.includes('/dompurify/')) return 'vendor-sanitize'
          return undefined
        },
      },
    },
  },
})

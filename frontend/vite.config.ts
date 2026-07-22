import path from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { inspectAttr } from 'plugin-inspect-react-code'

// https://vite.dev/config/
// The code-inspection plugin is dev-only: it must never ship in prod bundles.
export default defineConfig(({ mode }) => ({
  base: '/',
  plugins: [react(), ...(mode === 'development' ? [inspectAttr()] : [])],
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

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false
      }
    }
  },
  // In production builds, strip console.log/debug/info and debugger
  // statements via esbuild. console.warn and console.error remain so
  // legitimate runtime warnings still surface in DevTools — but anything
  // important should go through reportError() → Sentry, not console.
  esbuild: mode === 'production' ? {
    pure: ['console.log', 'console.debug', 'console.info'],
    drop: ['debugger'],
  } : undefined,
}))

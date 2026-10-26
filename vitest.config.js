import process from 'node:process'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.{test,spec}.{js,jsx,ts,tsx}'],
    // tests/e2e hits production (and can reach public Overpass): opt-in only, via npm run test:e2e
    exclude: ['node_modules', 'dist', 'android', 'ios', 'build', ...(process.env.E2E ? [] : ['tests/e2e/**'])],
    css: false,
  },
})

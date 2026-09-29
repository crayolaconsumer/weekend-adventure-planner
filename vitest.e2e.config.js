import { defineConfig } from 'vitest/config'

// End-to-end: the app's real Discover fetch code against production
// (E2E_BASE, default https://www.go-roam.uk). Network, slow: never in the unit run.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/e2e/**/*.e2e.test.js'],
    testTimeout: 120_000,
    fileParallelism: false,
    reporters: ['verbose', 'json'],
    outputFile: { json: 'e2e-results.json' },
  },
})

// Periodic evals (not the gate suite): npx vitest run -c vitest.eval.config.js
import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vitest.config.js'

export default mergeConfig(base, defineConfig({
  test: { include: ['tests/evals/**/*.eval.{js,ts}'], testTimeout: 600000 },
}))

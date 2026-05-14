import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // ios/ and android/ contain Capacitor's bundled native shells —
  // gradle wrappers, CocoaPods extractions, minified vendor JS inside
  // .aar/.framework packages. Linting them produced ~3500 false errors
  // that drowned out real signal in src/ and api/. build/ is a local
  // output directory not always ignored. dist/ stays ignored from the
  // original config.
  globalIgnores(['dist', 'build', 'ios', 'android']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // Allow motion (framer-motion JSX namespace), uppercase vars, and underscore-prefixed
      'no-unused-vars': ['error', { varsIgnorePattern: '^(motion|[A-Z]|_)' }],
    },
  },
  {
    // Server-side files run on Node, not the browser. Without this
    // override, every `process.env.X`, `Buffer.from(...)`, `URL`, etc.
    // gets flagged as no-undef — pure noise. Node globals come from
    // globals.node; we keep the React Hooks plugin off for these files
    // since they're not React.
    files: ['api/**/*.js', 'scripts/**/*.{js,mjs}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
])

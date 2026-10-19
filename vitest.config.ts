import { defineConfig } from 'vitest/config'

// Standalone test config (like the platform's): does not load the app's Vite plugins.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/rules/**', 'node_modules/**'],
    setupFiles: ['tests/setup.ts'],
    // Page tests drive whole screens; GitHub's runners are slower than a laptop (one timed out at 5 s).
    testTimeout: 20000,
  },
})

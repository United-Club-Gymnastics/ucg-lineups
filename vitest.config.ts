import { defineConfig } from 'vitest/config'

// Standalone test config (like the platform's): does not load the app's Vite plugins.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
  },
})

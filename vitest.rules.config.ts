import { defineConfig } from 'vitest/config'

// Firestore rules tests. Run through `npm run test:rules`, which starts the emulator first.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
})

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    // Tests run serially by default — they share ~/.inkpal/sessions/ writes
    fileParallelism: false,
    reporters: ['default'],
  },
});

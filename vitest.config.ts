import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'build/',
        'tests/',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
    },
    testTimeout: 30000, // 30 seconds for browser automation tests
    hookTimeout: 30000,
  },
});

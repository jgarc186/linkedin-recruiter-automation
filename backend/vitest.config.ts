import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.test.ts',
        'vitest.config.ts',
      ],
      thresholds: {
        lines: 96,
        functions: 92,
        branches: 93,
        statements: 96,
      },
    },
  },
  resolve: {
    alias: {
      '@shared': '../shared',
    },
  },
});
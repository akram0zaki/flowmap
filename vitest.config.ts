import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/ui/tokens/**/*.test.ts',
      'fixtures/src/**/*.test.ts',
      'apps/desktop/src/**/*.test.tsx',
      // The scale benchmark lives here because it needs both the fixtures and
      // the visual model, which no pure package is allowed to depend on.
      'apps/desktop/src/**/*.test.ts',
    ],
    environment: 'node',
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Coverage percentages are not the target; named behaviours are.
      // See docs/spec/11-quality-performance.md §2.
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
    },
  },
});

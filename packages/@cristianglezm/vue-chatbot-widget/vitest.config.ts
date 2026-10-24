import path from 'node:path';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

// standalone on purpose: the lib build config pulls in dts / css-injection plugins tests do not need.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{js,ts}'],
    setupFiles: ['tests/setup.js'],
    restoreMocks: true,
    // Loading jsdom is most of the time of the run (13 files = 13 jsdoms with isolation). The files share one jsdom
    // instead; tests/setup.js resets what they could leave behind, `npm run test:shuffle` checks the order does not matter
    // and `npm run test:isolated` runs them the slow way, one environment per file, to debug a suspicious failure.
    isolate: false,
    // little to run, so one worker (one jsdom) is faster than several that load it in parallel
    maxWorkers: 1,
  },
});

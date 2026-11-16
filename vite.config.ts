import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative paths, so the build works from any folder or host.
  base: './',
  server: { port: 5173 },
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'] },
});

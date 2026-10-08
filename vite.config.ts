import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths: works at a GitHub Pages project URL (/<repo>/) whatever the repo is named.
  base: './',
  build: {
    // Rapier ships its WASM inlined; code-splitting is deferred until after the High PnR slice (spec §66).
    chunkSizeWarningLimit: 6000,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

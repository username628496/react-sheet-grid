import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    lib: { entry: 'src/index.ts', formats: ['es', 'cjs'], fileName: (f) => (f === 'es' ? 'index.js' : 'index.cjs') },
    sourcemap: true,
    // Keep React out of the bundle: the host app provides it.
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      // The components use hooks and the DOM, so Next.js's App Router must treat the package as client code.
      output: { banner: "'use client';" },
    },
  },
  test: {
    // core/ and formula/ must run in plain Node (no DOM), so tests default to node.
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});

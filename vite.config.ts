import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    lib: { entry: 'src/index.ts', formats: ['es', 'cjs'], fileName: (f) => (f === 'es' ? 'index.js' : 'index.cjs') },
    // Keep React out of the bundle: the host app provides it.
    rollupOptions: { external: ['react', 'react-dom', 'react/jsx-runtime'] },
  },
  test: {
    // core/ and formula/ must run in plain Node (no DOM), so tests default to node.
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});

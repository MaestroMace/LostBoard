import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    // moved off Vite's default 5173 to avoid colliding with another local app
    port: 5273,
    // fail loudly if 5273 is taken rather than silently hopping to another port
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4273,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        /**
         * Tone is ~2/3 of the bundle and nothing on the start screen needs it,
         * so shipping it in the same chunk as the UI made first paint wait on
         * parsing an audio library. Splitting it lets the start screen render
         * while Tone streams in behind it.
         */
        manualChunks: {
          audio: ['tone'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});

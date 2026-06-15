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
  },
});

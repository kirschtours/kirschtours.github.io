import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' lets the build be served from any sub-path (Vercel, Netlify or a folder on GitHub Pages).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: { charts: ['recharts'], supabase: ['@supabase/supabase-js'], react: ['react', 'react-dom'] },
      },
    },
  },
  test: { environment: 'node' },
} as never);

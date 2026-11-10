import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      // API_PROXY_TARGET lets a second copy of the app run against another API (e.g. a large test library).
      '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:4000', changeOrigin: false },
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Stable vendor chunks: better long-term caching and a smaller initial download.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (/[\\/](recharts|d3-[^\\/]+|victory-vendor)[\\/]/.test(id)) return 'charts';
          if (/[\\/](@radix-ui|radix-ui)[\\/]/.test(id)) return 'radix';
          if (/[\\/](@tanstack|axios|zod|react-hook-form|@hookform)[\\/]/.test(id)) return 'data';
          return undefined;
        },
      },
    },
  },
});

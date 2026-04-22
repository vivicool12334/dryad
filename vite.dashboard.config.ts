import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Dashboard build config.
 * Produces a single self-contained HTML file at dist/dashboard/index.html.
 * No separate asset files — everything (JS, CSS, fonts) is inlined.
 *
 * Build: bun run build:dashboard
 * Served by: GET /Dryad/dashboard in routes.ts
 */
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  root: path.resolve(__dirname, 'src/dashboard'),
  build: {
    outDir: path.resolve(__dirname, 'dist/dashboard'),
    emptyOutDir: true,
    // Single-file plugin handles inlining — these settings help it work
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/dashboard/index.html'),
      output: {
        // Ensure everything ends up in one file
        inlineDynamicImports: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/dashboard'),
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', '@tanstack/react-query', 'recharts'],
  },
  server: {
    port: 5173,
    proxy: {
      '/Dryad': {
        target: process.env.AGENT_URL || 'http://5.75.225.23:3000',
        changeOrigin: true,
      },
    },
  },
});

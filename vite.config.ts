/**
 * Build and test configuration.
 *
 * One file on purpose. Vitest ships its own copy of Vite, and two Vite
 * installations in one project means the two `vite.config` files disagree about
 * plugin types — so the test config lives here, in the file that actually builds
 * the app.
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

const src = (...p: string[]) => fileURLToPath(new URL('./src/' + p.join('/'), import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'fonts/*'],
      manifest: {
        name: 'Duly — offline invoicing',
        short_name: 'Duly',
        description: 'Invoices, duly done. Offline-first invoicing for Australian businesses.',
        theme_color: '#1F5E5B',
        background_color: '#FAF8F4',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2,ttf,otf}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': src() },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@react-pdf')) return 'pdf';
          if (id.includes('exceljs')) return 'xlsx';
          if (id.includes('/docx/')) return 'docx';
          if (id.includes('recharts')) return 'charts';
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        },
      },
    },
  },
  server: { port: 5183, strictPort: false },
  preview: { port: 4183 },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/core/**', 'src/lib/**'],
      exclude: ['src/test/**', '**/*.d.ts'],
    },
  },
});

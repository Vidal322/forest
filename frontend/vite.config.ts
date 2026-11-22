/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// The API runs on :8080 in development. Proxying it means the browser only ever
// talks to one origin, so no CORS setup is needed and cookies/auth stay simple.
const api = process.env.FOREST_API_URL ?? 'http://127.0.0.1:8080'

export default defineConfig({
  plugins: [
    react(),
    // Installable app that opens without signal: the app shell is precached, and
    // field photos are cached on first view (they never change under a key).
    // Data and queued changes are kept by TanStack Query in IndexedDB (src/app/persist.ts).
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Forest — field tracker',
        short_name: 'Forest',
        description: 'Track planting, sowing and watering across your field.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#4f6b3a',
        background_color: '#f4f1ea',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/healthz$/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/photos/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'field-photos',
              expiration: { maxEntries: 10 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    // Anchored patterns, so a future page like /apiary is never sent to the API.
    proxy: {
      '^/api/': api,
      '^/healthz$': api,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
    unstubGlobals: true,
  },
})

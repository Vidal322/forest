/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The API runs on :8080 in development. Proxying it means the browser only ever
// talks to one origin, so no CORS setup is needed and cookies/auth stay simple.
const api = process.env.FOREST_API_URL ?? 'http://127.0.0.1:8080'

export default defineConfig({
  plugins: [react()],
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

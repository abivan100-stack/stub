/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'

// `--mode http` skips the self-signed cert. localhost is a secure context already (used by e2e tests).
export default defineConfig(({ mode }) => ({
  plugins: [
    svelte(),
    mode !== 'http' && basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      workbox: {
        // Precache everything, fonts and the QR worker included, so the app runs with no network.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        navigateFallback: 'index.html',
      },
      manifest: {
        name: 'Stub',
        short_name: 'Stub',
        description: 'Pass files between two devices on the same Wi-Fi or hotspot. No internet needed.',
        theme_color: '#e6e3da',
        background_color: '#e6e3da',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
    }),
  ],
  // Reachable from phones on the same network: https://<your-lan-ip>:5173
  server: { host: true },
  preview: { host: true },
  test: { include: ['tests/**/*.test.ts'] },
}))

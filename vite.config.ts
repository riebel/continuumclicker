import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Relative base so the build works on GitHub Pages sub-paths and any static host.
  base: './',
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'Continuum Clicker',
        short_name: 'Continuum',
        description: 'To boldly click where no one has clicked before.',
        theme_color: '#05060f',
        background_color: '#05060f',
        display: 'fullscreen',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,webp,png,woff2,glb}'],
        // Include the detailed Blender refits (4.52 MB) in offline installations.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // The UI is English-only: skip font subsets the browser never downloads.
        globIgnores: ['**/*-{greek,greek-ext,cyrillic,cyrillic-ext,vietnamese}-*.woff2'],
      },
    }),
  ],
  build: {
    // three.js lives in its own lazily loaded chunk.
    chunkSizeWarningLimit: 1300,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
})

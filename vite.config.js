import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // The Capacitor native-only plugin is dynamically imported from
  // src/lib/gps.js but only ever called on iOS/Android. We mark it as
  // "external" so Rollup (and vite-plugin-pwa's separate build pass)
  // skip resolving it during the web build, where the package's
  // native-only package.json entry would otherwise cause:
  //   "Failed to resolve entry for package
  //    '@capacitor-community/background-geolocation'"
  build: {
    rollupOptions: {
      external: ['@capacitor-community/background-geolocation'],
    },
  },
  optimizeDeps: {
    exclude: ['@capacitor-community/background-geolocation'],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'KnockIQ',
        short_name: 'KnockIQ',
        description: 'Door-to-door sales operations platform for reps and managers.',
        theme_color: '#1B4FCC',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,txt,xml}'],
        // CRITICAL: do NOT let the SW intercept "/" or "/welcome.html".
        // Vercel rewrites "/" → /welcome.html (the marketing landing page).
        // Without these denylist entries, the default Workbox NavigationRoute
        // serves the precached React index.html for "/" instead, which then
        // boots the app, finds no user, and fires <WelcomeRedirect> →
        // window.location.replace("/"). The SW intercepts again, app boots
        // again, infinite redirect loop = "loading screen blinks forever".
        // The denylist makes "/" fall through to the network so Vercel's
        // rewrite to welcome.html actually gets a chance to fire.
        navigateFallbackDenylist: [/^\/$/, /^\/welcome\.html$/, /^\/welcome-v2\.html$/, /^\/screenshot-test\.html$/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'map-tiles', expiration: { maxEntries: 500, maxAgeSeconds: 604800 } }
          }
        ]
      }
    })
  ]
})

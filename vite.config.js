import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Shack Shine Canvassing',
        short_name: 'Canvassing',
        description: 'Field canvassing tracker for Shack Shine reps',
        theme_color: '#1A6B3A',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
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

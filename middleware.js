// Vercel Routing Middleware (framework-agnostic; runs at the edge before
// vercel.json routing). Handles the two host-based redirects that the legacy
// `routes` `has: host` conditions did NOT honor on this project:
//
//   1. The auto-assigned *.vercel.app production URL → canonical marketing
//      domain, so it isn't publicly usable.
//   2. The app domain's root → /login (the app), instead of the marketing
//      homepage that vercel.json serves at / for getknockiq.com.
//
// Everything else returns undefined → continues to the normal vercel.json
// routes (welcome.html at /, the SPA fallback, headers, etc.). No external
// deps: we return plain Response objects.

export const config = {
  // Run on every path so the vercel.app redirect catches deep links too.
  matcher: '/:path*',
}

const VERCEL_HOST = 'canvassing-app-theta.vercel.app'
const APP_HOST = 'app.getknockiq.com'
const MARKETING_ORIGIN = 'https://www.getknockiq.com'

export default function middleware(request) {
  const url = new URL(request.url)
  const host = request.headers.get('host') || url.host

  // 1. Hide the Vercel-generated domain — 308 to the canonical marketing site,
  //    preserving the path + query so deep links keep working.
  if (host === VERCEL_HOST) {
    return new Response(null, {
      status: 308,
      headers: { Location: `${MARKETING_ORIGIN}${url.pathname}${url.search}` },
    })
  }

  // 2. On the app domain, the bare root sends people into the app (login),
  //    not the marketing homepage. Relative Location resolves against the
  //    app host. 307 (temporary) so it's never hard-cached.
  if (host === APP_HOST && url.pathname === '/') {
    return new Response(null, {
      status: 307,
      headers: { Location: '/login' },
    })
  }

  // Everything else: continue to normal routing.
  return undefined
}

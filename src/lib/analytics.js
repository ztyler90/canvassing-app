/**
 * analytics.js — thin PostHog wrapper.
 *
 * Centralizes product analytics behind track / identify / reset so call sites
 * stay simple, and so the whole thing no-ops cleanly when no key is configured
 * (local dev, preview builds, or before the env var is set). PostHog only
 * initializes when VITE_POSTHOG_KEY is present — nothing is sent and no network
 * calls fire otherwise.
 *
 * US Cloud by default (override with VITE_POSTHOG_HOST). Person properties are
 * deliberately kept non-PII — id + role + org + plan only, never email/name —
 * to match the app's privacy posture. autocapture is off so we only ever send
 * explicit, named events.
 */
import posthog from 'posthog-js'

const KEY  = import.meta.env.VITE_POSTHOG_KEY
const HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com'

let ready = false

export function initAnalytics() {
  if (ready || !KEY) return
  try {
    posthog.init(KEY, {
      api_host: HOST,
      autocapture: false,
      capture_pageview: true,
      capture_pageleave: true,
      person_profiles: 'identified_only',
      persistence: 'localStorage+cookie',
    })
    ready = true
  } catch (err) {
    console.warn('[analytics] init failed:', err?.message || err)
  }
}

/** Send a named event. No-ops until PostHog is initialized. */
export function track(event, props = {}) {
  if (!ready) return
  try { posthog.capture(event, props) } catch { /* analytics must never throw */ }
}

/**
 * Tie subsequent events to a user. Non-PII only — we pass the Supabase user id
 * as the distinct id and a few safe org/role properties, never email or name.
 */
export function identify(user) {
  if (!ready || !user?.id) return
  try {
    const orgId = user.organization_id || user.organization?.id || null
    posthog.identify(user.id, {
      role:     user.role || null,
      org_id:   orgId,
      org_tier: user.organization?.tier || null,
      plan:     user.organization?.selected_plan || null,
    })
    if (orgId) {
      posthog.group('organization', orgId, {
        name: user.organization?.name || undefined,
        tier: user.organization?.tier || undefined,
      })
    }
  } catch (err) {
    console.warn('[analytics] identify failed:', err?.message || err)
  }
}

/** Clear identity on sign-out so the next user starts a fresh anonymous id. */
export function resetAnalytics() {
  if (!ready) return
  try { posthog.reset() } catch { /* no-op */ }
}

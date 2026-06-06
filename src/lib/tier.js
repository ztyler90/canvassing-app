/**
 * Tier helpers — single source of truth for feature gating between the
 * Standard ($25/seat) and Pro ($50/seat) tiers. Enterprise ($100/seat) is
 * marketed on the website but not yet configured in-app, so there is no
 * 'enterprise' tier value here on purpose.
 *
 * The org row carries `tier` ('standard' | 'pro') and, for the Pro
 * commission add-on, `commission_enabled` (boolean).
 */

// Standard tier caps territories; Pro is effectively unlimited (51+).
export const STANDARD_MAX_TERRITORIES = 50

/** True when the org is on the Pro tier. Falls back to legacy user.plan. */
export function isProTier(org, user = null) {
  return (org?.tier || user?.plan) === 'pro'
}

/**
 * Commission tracking is a Pro-only, opt-in add-on. It only counts as "on"
 * when the org is Pro AND the manager has explicitly enabled the add-on.
 */
export function isCommissionEnabled(org, user = null) {
  return isProTier(org, user) && !!org?.commission_enabled
}

/**
 * Roof Insights (Google Solar) is a Pro-only, opt-in add-on. It only counts as
 * "on" when the org is Pro AND the manager has explicitly enabled it. Default
 * off so no billable Solar lookup ever happens for teams that don't want it.
 */
export function isRoofInsightsEnabled(org, user = null) {
  return isProTier(org, user) && !!org?.roof_insights_enabled
}

/** Whether the org can create another territory given its current count. */
export function canCreateTerritory(org, currentCount, user = null) {
  if (isProTier(org, user)) return true
  return currentCount < STANDARD_MAX_TERRITORIES
}

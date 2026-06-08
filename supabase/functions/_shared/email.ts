/**
 * _shared/email.ts · KnockIQ transactional email toolkit
 * ----------------------------------------------------------------------------
 * One place for everything Resend-related so the individual edge functions
 * (manage-team, notify-closer, send-welcome, send-closer-onboarding) don't
 * each re-implement the Resend POST, the HTML escaping, and the branded
 * layout. Before this module those three concerns were copy-pasted across
 * functions and slowly drifting apart.
 *
 * Functions here are intentionally framework-free (no JSX, no template
 * engine) — Supabase edge functions run on Deno and we keep cold starts
 * cheap by leaning on plain string templates.
 *
 * Env read at module load (injected per-function in the Supabase dashboard):
 *   RESEND_API_KEY  — required to actually send; absent → sendEmail no-ops
 *                     with { ok:false } so callers can surface a soft warning
 *                     instead of throwing.
 *   RESEND_FROM     — the verified "From" header. Falls back to Resend's
 *                     shared sandbox sender (poor deliverability, fine for
 *                     internal testing).
 */

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const RESEND_FROM    = Deno.env.get('RESEND_FROM')    || 'KnockIQ <onboarding@resend.dev>'
// Default Reply-To for every transactional email. The sending domain
// (send.getknockiq.com) is send-only — its MX points at SES's bounce
// handler, not an inbox — so replies need to route to a real monitored
// mailbox on the root domain. Set via the RESEND_REPLY_TO secret
// (e.g. hello@getknockiq.com). A per-call replyTo still overrides this.
const RESEND_REPLY_TO = Deno.env.get('RESEND_REPLY_TO') || ''

// Brand tokens — single source of truth for the look of every email.
export const BRAND = {
  name:       'KnockIQ',
  primary:    '#1B4FCC', // KnockIQ blue (header + CTA)
  primaryInk: '#DBEAFE', // light-blue sub-text on the header
  pageBg:     '#F3F4F6',
  cardBg:     '#FFFFFF',
  ink:        '#111827',
  inkSoft:    '#374151',
  inkMuted:   '#6B7280',
  font:       "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  // White wordmark for the blue header. Must be an ABSOLUTE https URL — email
  // clients won't resolve relative paths. Hosted on the marketing domain
  // (getknockiq.com), which is live and stable and independent of whichever
  // origin the app itself is deployed to. Every email uses this single URL.
  logoUrl:    'https://www.getknockiq.com/logo-white.png',
} as const

// ── HTML escaping ───────────────────────────────────────────────────────────
export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
export function escapeAttr(s: unknown): string {
  return escapeHtml(s)
}

// ── Resend transport ────────────────────────────────────────────────────────
export interface SendResult { ok: boolean; error?: string; id?: string }

/**
 * POST a single email through Resend's REST API. Never throws — every
 * failure mode collapses to { ok:false, error } so a missed email can't
 * roll back the action that triggered it (creating a rep, assigning a
 * lead, provisioning an org).
 */
export async function sendEmail({
  to, subject, html, text, replyTo,
}: {
  to:       string | string[]
  subject:  string
  html:     string
  text:     string
  replyTo?: string
}): Promise<SendResult> {
  if (!RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set — skipping send:', subject)
    return { ok: false, error: 'RESEND_API_KEY not configured' }
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:     RESEND_FROM,
        to:       Array.isArray(to) ? to : [to],
        subject,
        html,
        text,
        ...((replyTo || RESEND_REPLY_TO) ? { reply_to: replyTo || RESEND_REPLY_TO } : {}),
      }),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('[email] Resend send failed', res.status, errText)
      return { ok: false, error: `Resend ${res.status}: ${errText.slice(0, 200)}` }
    }
    const body = await res.json().catch(() => ({}))
    return { ok: true, id: (body as { id?: string })?.id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[email] Resend fetch threw:', msg)
    return { ok: false, error: msg }
  }
}

// ── Branded layout ──────────────────────────────────────────────────────────
export interface DetailRow { label: string; value: string }

export interface BrandedEmailOpts {
  /** Contextual line under the logo, e.g. "Welcome aboard" or "You're a closer". */
  eyebrow?:   string
  /** Optional title line under the logo (e.g. "New Lead"). The brand name is
   *  already the logo, so don't pass "KnockIQ" here — it's ignored if you do. */
  heading?:   string
  /** Absolute https URL of the white wordmark. Defaults to BRAND.logoUrl. */
  logoUrl?:   string
  /** Greeting line, e.g. "Hey Mike," */
  greeting?:  string
  /** One or more paragraphs of intro copy (already plain text; escaped here). */
  intro?:     string | string[]
  /** Optional label/value table rendered as a clean two-column block. */
  rows?:      DetailRow[]
  /** Primary call-to-action button. */
  cta?:       { label: string; url: string }
  /** Small print under the CTA (escaped). */
  footnote?:  string
}

/**
 * Render the shared KnockIQ email shell. Every transactional email funnels
 * through here so the header, card, button, and footer stay identical.
 */
export function brandedEmail(opts: BrandedEmailOpts): string {
  const logoUrl = opts.logoUrl || BRAND.logoUrl
  // The logo IS the wordmark — only render a text title if the caller passed
  // something other than the brand name (e.g. "New Lead").
  const titleText = opts.heading && opts.heading !== BRAND.name ? opts.heading : ''
  const title   = titleText ? `<div style="color:#FFFFFF;font-weight:700;font-size:16px;margin-top:12px;">${escapeHtml(titleText)}</div>` : ''
  const eyebrow  = opts.eyebrow ? `<div style="color:${BRAND.primaryInk};font-size:13px;margin-top:${titleText ? '2' : '10'}px;">${escapeHtml(opts.eyebrow)}</div>` : ''
  const greeting = opts.greeting ? `<p style="margin:0 0 12px 0;font-size:15px;color:${BRAND.ink};">${escapeHtml(opts.greeting)}</p>` : ''

  const intros = Array.isArray(opts.intro) ? opts.intro : opts.intro ? [opts.intro] : []
  const introHtml = intros
    .map((p) => `<p style="margin:0 0 16px 0;font-size:14px;line-height:1.55;color:${BRAND.inkSoft};">${escapeHtml(p)}</p>`)
    .join('')

  const rowsHtml = (opts.rows && opts.rows.length)
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:4px 0 4px 0;">
        ${opts.rows
          .filter((r) => r.value)
          .map((r) => `<tr><td style="padding:6px 0;color:${BRAND.inkMuted};font-size:13px;width:130px;vertical-align:top;">${escapeHtml(r.label)}</td><td style="padding:6px 0;color:${BRAND.ink};font-size:14px;font-weight:600;">${escapeHtml(r.value)}</td></tr>`)
          .join('')}
      </table>`
    : ''

  const ctaHtml = opts.cta
    ? `<div style="margin-top:24px;">
        <a href="${escapeAttr(opts.cta.url)}" style="display:inline-block;padding:13px 26px;background:${BRAND.primary};color:#FFFFFF;text-decoration:none;font-weight:700;border-radius:10px;font-size:14px;">${escapeHtml(opts.cta.label)}</a>
      </div>`
    : ''

  const footnoteHtml = opts.footnote
    ? `<p style="margin:20px 0 0 0;font-size:12px;line-height:1.5;color:${BRAND.inkMuted};">${escapeHtml(opts.footnote)}</p>`
    : ''

  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;padding:0;background:${BRAND.pageBg};font-family:${BRAND.font};color:${BRAND.ink};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.pageBg};padding:32px 16px;"><tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:${BRAND.cardBg};border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    <tr><td style="background:${BRAND.primary};padding:22px 28px;">
      <img src="${escapeAttr(logoUrl)}" alt="${escapeAttr(BRAND.name)}" height="30" style="height:30px;width:auto;display:block;border:0;outline:none;text-decoration:none;" />
      ${title}
      ${eyebrow}
    </td></tr>
    <tr><td style="padding:26px 28px;">
      ${greeting}
      ${introHtml}
      ${rowsHtml}
      ${ctaHtml}
      ${footnoteHtml}
    </td></tr>
    <tr><td style="padding:18px 28px;border-top:1px solid #EEF0F3;">
      <div style="color:${BRAND.inkMuted};font-size:12px;">— The ${BRAND.name} team</div>
    </td></tr>
  </table>
</td></tr></table></body></html>`
}

/**
 * Plain-text counterpart to brandedEmail. Same content, no markup — every
 * email should ship a text/plain part for deliverability and accessibility.
 */
export function brandedText(opts: BrandedEmailOpts): string {
  const lines: string[] = []
  if (opts.greeting) lines.push(opts.greeting, '')
  const intros = Array.isArray(opts.intro) ? opts.intro : opts.intro ? [opts.intro] : []
  for (const p of intros) { lines.push(p, '') }
  if (opts.rows && opts.rows.length) {
    for (const r of opts.rows) { if (r.value) lines.push(`${r.label}: ${r.value}`) }
    lines.push('')
  }
  if (opts.cta) { lines.push(`${opts.cta.label}: ${opts.cta.url}`, '') }
  if (opts.footnote) { lines.push(opts.footnote, '') }
  lines.push(`— The ${BRAND.name} team`)
  return lines.join('\n')
}

/** Convenience: first-name greeting from a full name. */
export function firstNameGreeting(fullName?: string | null): string {
  const first = (fullName || '').trim().split(/\s+/)[0]
  return first ? `Hey ${first},` : 'Hey there,'
}

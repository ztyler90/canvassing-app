/**
 * photos.js — signed-URL plumbing for the private avatars and
 * interaction-photos Storage buckets.
 *
 * Background: both buckets were originally created public so the app could
 * render <img src={publicUrl}> directly. That posture was incompatible with
 * any claim of safeguarding homeowner imagery — URL knowledge equals read
 * access. The 20260529_private_storage_buckets migration converts both
 * buckets to private and adds same-org SELECT RLS. After that flip, photos
 * must be fetched as short-lived signed URLs.
 *
 * Backwards compatibility: existing rows in `users.avatar_url` and
 * `interactions.photo_urls` were stored as full public URLs (e.g.
 * https://xxx.supabase.co/storage/v1/object/public/avatars/<path>). The
 * `extractStoragePath` helper recognizes that pattern and pulls the path
 * out so the same upgrade works for old and new rows without a data
 * migration. Any unknown URL form is passed through unchanged (browser
 * will 404 it after the bucket flip — display sites should render the
 * empty-state placeholder when usePhotoUrl returns null).
 */
import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

// In-memory cache of signed URLs so a list of photos doesn't re-sign on
// every re-render. Keyed by `${bucket}:${path}`. We expire entries 5min
// before the underlying URL's lifetime so we never hand out a near-dead URL.
const SIGNED_URL_TTL_SECONDS = 60 * 60       // 1 hour
const CACHE_TTL_MS          = (SIGNED_URL_TTL_SECONDS - 300) * 1000
const cache = new Map()

/**
 * Take whatever was stored in a row — could be a legacy public URL, a new
 * storage path, or null — and return just the storage path (or null if it
 * doesn't look like one we can sign).
 */
export function extractStoragePath(value) {
  if (!value || typeof value !== 'string') return null
  // Already a path (no protocol). Good.
  if (!/^https?:\/\//i.test(value)) return value
  // Legacy public Supabase URL — peel off the path.
  //   https://<proj>.supabase.co/storage/v1/object/public/<bucket>/<path>
  const m = value.match(/\/storage\/v1\/object\/public\/[^/]+\/(.+)$/)
  if (m) return decodeURIComponent(m[1])
  // Unknown URL — bail. Caller will render a placeholder.
  return null
}

/**
 * Mint a signed URL for an interaction photo or avatar. Use in
 * non-React code; React components should prefer `usePhotoUrl`.
 */
export async function getSignedPhotoUrl(pathOrUrl, bucket = 'interaction-photos') {
  const path = extractStoragePath(pathOrUrl)
  if (!path) return null
  const cacheKey = `${bucket}:${path}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.url
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error) {
    console.warn('[photos] sign failed', bucket, path, error.message)
    return null
  }
  const url = data?.signedUrl || null
  if (url) cache.set(cacheKey, { url, expiresAt: Date.now() + CACHE_TTL_MS })
  return url
}

/**
 * React hook: takes a stored value (path or legacy URL) and returns a
 * fresh signed URL. Returns null while loading or on failure — components
 * should render an empty state when the value is null.
 */
export function usePhotoUrl(pathOrUrl, bucket = 'interaction-photos') {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!pathOrUrl) { setUrl(null); return }
    let alive = true
    getSignedPhotoUrl(pathOrUrl, bucket).then((u) => {
      if (alive) setUrl(u)
    })
    return () => { alive = false }
  }, [pathOrUrl, bucket])
  return url
}

/**
 * Drop-in <img> replacement that handles the async signing transparently.
 * Renders a tinted placeholder div until the signed URL resolves.
 *
 * Props mirror <img> (className, alt, onClick) plus `pathOrUrl` and
 * `bucket`. Anything else is forwarded.
 */
export function StoragePhoto({
  pathOrUrl,
  bucket = 'interaction-photos',
  className = '',
  alt = '',
  placeholderClassName,
  ...rest
}) {
  const url = usePhotoUrl(pathOrUrl, bucket)
  if (!url) {
    return (
      <div
        className={`${placeholderClassName ?? className} bg-gray-100`}
        aria-label={alt || 'Loading photo'}
      />
    )
  }
  return <img src={url} alt={alt} className={className} {...rest} />
}

/**
 * Thumbnail variant: same signed-URL fetch, wrapped in an <a> that opens
 * the full photo in a new tab. Use this in lists of interaction photos
 * (SessionDetail, ManagerDashboard) where tapping the thumb should let
 * the rep / manager see the full-size image.
 */
export function PhotoThumb({
  pathOrUrl,
  bucket = 'interaction-photos',
  className = '',
  alt = '',
}) {
  const url = usePhotoUrl(pathOrUrl, bucket)
  if (!url) return <div className={`${className} bg-gray-100`} aria-label={alt || 'Loading photo'} />
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      <img src={url} alt={alt} className={className} />
    </a>
  )
}

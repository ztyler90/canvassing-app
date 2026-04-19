/**
 * Block Coverage Heatmap
 * ──────────────────────
 * Converts a flat list of interactions into a grid of cells shaded
 * by "recency of last visit". Reps use this to avoid re-canvassing
 * blocks they or a teammate hit yesterday.
 *
 * Cell size
 * ─────────
 * 30m cells ≈ one mid-size lot. Smaller than that and a single house
 * straddles cells, bigger and a whole block flattens into one tile.
 * At Tampa's latitude (27.95°), 30m in longitude is ~0.000300° and
 * 30m in latitude is ~0.000270°. We use both in the key so cells
 * stay roughly square even far from the equator.
 *
 * Recency buckets (configurable via `now` for testing):
 *   fresh (≤24h)   — red, strongest signal ("don't re-hit today")
 *   recent (≤7d)   — amber, moderate
 *   older (≤30d)   — green, faded ("touched but open for re-hits")
 *
 * Interactions beyond 30d are ignored; callers upstream already
 * scope their fetch. A cell's color comes from the MOST recent
 * interaction in it — older hits within the same cell don't matter
 * for re-canvass avoidance.
 */

const CELL_LAT_DEG = 0.00027   // ~30m at Tampa latitude
const CELL_LNG_DEG = 0.00030

const MS_DAY = 24 * 3600 * 1000

export const HEATMAP_COLORS = {
  fresh:  { fill: '#EF4444', border: '#B91C1C', label: '≤ 24h' },
  recent: { fill: '#F59E0B', border: '#B45309', label: '≤ 7d'  },
  older:  { fill: '#10B981', border: '#047857', label: '≤ 30d' },
}

/**
 * Bucket raw interactions into cell records ready for rendering.
 * Each cell has its bounding box, the recency bucket, and the count
 * of interactions that landed there. Cells without recent interactions
 * are omitted entirely (no gray cells — unknowns stay transparent).
 */
export function bucketIntoCells(interactions, now = Date.now()) {
  const cells = new Map()  // key → { bbox, bucket, count, lastTs }

  for (const it of interactions) {
    if (!Number.isFinite(it.lat) || !Number.isFinite(it.lng)) continue
    const ts = it.created_at ? new Date(it.created_at).getTime() : now
    const ageDays = (now - ts) / MS_DAY
    if (ageDays > 30) continue

    const latIdx = Math.floor(it.lat / CELL_LAT_DEG)
    const lngIdx = Math.floor(it.lng / CELL_LNG_DEG)
    const key    = `${latIdx}:${lngIdx}`

    const bucket = ageDays <= 1 ? 'fresh' : ageDays <= 7 ? 'recent' : 'older'
    const existing = cells.get(key)
    if (!existing) {
      const minLat = latIdx * CELL_LAT_DEG
      const minLng = lngIdx * CELL_LNG_DEG
      cells.set(key, {
        bbox:   [[minLat, minLng], [minLat + CELL_LAT_DEG, minLng + CELL_LNG_DEG]],
        bucket,
        count:  1,
        lastTs: ts,
      })
    } else {
      existing.count++
      // Keep the freshest bucket for this cell.
      if (ts > existing.lastTs) {
        existing.lastTs = ts
        existing.bucket = bucket
      }
    }
  }

  return Array.from(cells.values())
}

/**
 * Filter a flat interaction list down to a rolling window ending `now`.
 * Convenience so callers can flip between 24h / 7d / 30d views without
 * refetching from the API.
 */
export function filterByWindow(interactions, windowDays, now = Date.now()) {
  const cutoff = now - windowDays * MS_DAY
  return interactions.filter((it) => {
    const ts = it.created_at ? new Date(it.created_at).getTime() : 0
    return ts >= cutoff
  })
}

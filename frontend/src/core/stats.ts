export type Series = ReadonlyArray<number | null>

export function isNum(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v)
}

/** Linear-interpolated quantile of an ascending-sorted array (pandas/numpy "linear"). */
export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length
  if (n === 0) return NaN
  const pos = (n - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.min(lo + 1, n - 1)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export function quantile(values: Series, q: number): number | null {
  const v = values.filter(isNum).sort((a, b) => a - b)
  return v.length ? quantileSorted(v, q) : null
}

export const median = (values: Series) => quantile(values, 0.5)

export function mean(values: Series): number | null {
  let s = 0
  let n = 0
  for (const v of values) {
    if (!isNum(v)) continue
    s += v
    n++
  }
  return n ? s / n : null
}

export interface Band {
  median: (number | null)[]
  lo: (number | null)[]
  hi: (number | null)[]
}

/**
 * Centered rolling quantiles with pandas semantics: the window for index i spans
 * [i + 1 + offset - w, i + offset] with offset = (w - 1) // 2 (so w = 14 covers i-7..i+6), and a
 * value is emitted only when at least minPeriods = max(3, w // 3) finite samples fall inside it.
 */
export function rollingBand(values: Series, w = 14, qs: [number, number, number] = [0.25, 0.5, 0.75]): Band {
  const n = values.length
  const minPeriods = Math.max(3, Math.floor(w / 3))
  const offset = Math.floor((w - 1) / 2)
  const lo: (number | null)[] = new Array(n).fill(null)
  const md: (number | null)[] = new Array(n).fill(null)
  const hi: (number | null)[] = new Array(n).fill(null)
  const buf: number[] = []
  for (let i = 0; i < n; i++) {
    const end = Math.min(n, i + 1 + offset)
    const start = Math.max(0, i + 1 + offset - w)
    buf.length = 0
    for (let j = start; j < end; j++) {
      const v = values[j]
      if (isNum(v)) buf.push(v)
    }
    if (buf.length < minPeriods) continue
    buf.sort((a, b) => a - b)
    lo[i] = quantileSorted(buf, qs[0])
    md[i] = quantileSorted(buf, qs[1])
    hi[i] = quantileSorted(buf, qs[2])
  }
  return { median: md, lo, hi }
}

export const rollingMedian = (values: Series, w = 7) => rollingBand(values, w).median

/** Circular mean of clock hours. Returns the mean hour in [0, 24) and resultant length R in [0, 1]. */
export function circularMeanHours(hours: Series): { hour: number; r: number } | null {
  let x = 0
  let y = 0
  let n = 0
  for (const h of hours) {
    if (!isNum(h)) continue
    const a = (h / 24) * 2 * Math.PI
    x += Math.cos(a)
    y += Math.sin(a)
    n++
  }
  if (!n) return null
  const a = Math.atan2(y / n, x / n)
  return { hour: ((((a / (2 * Math.PI)) * 24) % 24) + 24) % 24, r: Math.hypot(x / n, y / n) }
}

/** Median of clock hours that may wrap midnight: values are unwrapped around their circular mean first. */
export function clockMedian(hours: Series): number | null {
  const c = circularMeanHours(hours)
  if (!c) return null
  const unwrapped = hours.filter(isNum).map((h) => {
    let d = (((h - c.hour) % 24) + 24) % 24
    if (d > 12) d -= 24
    return c.hour + d
  })
  const m = median(unwrapped)
  return m == null ? null : ((m % 24) + 24) % 24
}

export function extent(values: Series, pad = 0): [number, number] | null {
  let lo = Infinity
  let hi = -Infinity
  for (const v of values) {
    if (!isNum(v)) continue
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  if (lo === Infinity) return null
  const p = (hi - lo || Math.abs(hi) || 1) * pad
  return [lo - p, hi + p]
}

/** Mean of fixed-size chunks; used to aggregate long day series to weeks for SVG node budgets. */
export function chunkMean(values: Series, size: number): (number | null)[] {
  const out: (number | null)[] = []
  for (let i = 0; i < values.length; i += size) out.push(mean(values.slice(i, i + size)))
  return out
}

/** Unwrap a clock-hour series to a continuous evening-anchored scale, e.g. 23.5 -> 23.5, 0.5 -> 24.5. */
export function unwrapEvening(h: number | null, pivot = 12): number | null {
  if (!isNum(h)) return null
  return h < pivot ? h + 24 : h
}

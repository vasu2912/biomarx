import type { MetricDef } from './domain'
import { clock, duration } from './time'

export function fixed(v: number | null | undefined, decimals = 0): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function compact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
}

export function signed(v: number, decimals = 0): string {
  const s = fixed(Math.abs(v), decimals)
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : `±${s}`
}

type Fmt = Pick<MetricDef, 'unit' | 'decimals' | 'clock'>

/** Clock metrics render as times of day and hour/minute metrics as durations, not raw numbers. */
export function formatMetric(def: Fmt, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  if (def.clock) return clock(v)
  if (def.unit === 'min') return duration(v)
  if (def.unit === 'h') return duration(v * 60)
  return fixed(v, def.decimals)
}

export function unitSuffix(def: Fmt): string {
  if (def.clock || ['min', 'h', '', 'index', 'steps'].includes(def.unit)) return ''
  return def.unit === 'km/hr' ? 'km/h' : def.unit
}

export type DeltaTone = 'good' | 'bad' | 'neutral'

export function deltaTone(delta: number, direction: MetricDef['direction'], epsilon = 1e-9): DeltaTone {
  if (Math.abs(delta) < epsilon || direction === 'neutral') return 'neutral'
  return (delta > 0) === (direction === 'higher') ? 'good' : 'bad'
}

/** Delta in the metric's natural unit: clock metrics compare on the circle, in minutes. */
export function formatDelta(def: Fmt, delta: number): string {
  if (def.clock) {
    const m = Math.round(delta * 60)
    return `${m > 0 ? '+' : m < 0 ? '−' : '±'}${duration(Math.abs(m))}`
  }
  if (def.unit === 'min') return `${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${duration(Math.abs(delta))}`
  if (def.unit === 'h') return `${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${duration(Math.abs(delta * 60))}`
  return signed(delta, def.decimals)
}

/** Signed shortest difference between two clock hours, in hours (-12, 12]. */
export function clockDiff(a: number, b: number): number {
  let d = (((a - b) % 24) + 24) % 24
  if (d > 12) d -= 24
  return d
}

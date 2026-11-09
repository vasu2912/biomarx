import type { Range } from './domain'
import { addDays, daysBetween, type IsoDate } from './time'

export const PRESETS = [
  { key: '90d', label: '90D', days: 90 },
  { key: '6m', label: '6M', days: 182 },
  { key: '1y', label: '1Y', days: 365 },
  { key: 'all', label: 'All', days: Infinity },
] as const

export type PresetKey = (typeof PRESETS)[number]['key']

export type RangeSelection = { kind: 'preset'; preset: PresetKey } | { kind: 'custom'; start: IsoDate; end: IsoDate }

export const DEFAULT_SELECTION: RangeSelection = { kind: 'preset', preset: '1y' }

/** Resolve a selection against the dataset span, clamped so a range is never empty or outside the data. */
export function resolveRange(sel: RangeSelection, span: Range): Range {
  if (sel.kind === 'custom') {
    const start = sel.start < span.start ? span.start : sel.start
    const end = sel.end > span.end ? span.end : sel.end
    return start < end ? { start, end } : span
  }
  const p = PRESETS.find((x) => x.key === sel.preset)!
  if (!Number.isFinite(p.days)) return span
  const start = addDays(span.end, -p.days)
  return { start: start < span.start ? span.start : start, end: span.end }
}

/** The equal-length period immediately before a range, or null when it would start before the data. */
export function previousRange(r: Range, span: Range): Range | null {
  const n = daysBetween(r.start, r.end)
  const start = addDays(r.start, -n)
  if (start < span.start) return daysBetween(span.start, r.start) >= 14 ? { start: span.start, end: r.start } : null
  return { start, end: r.start }
}

export function encodeSelection(sel: RangeSelection): Record<string, string> {
  return sel.kind === 'preset' ? { range: sel.preset } : { from: sel.start, to: sel.end }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

export function decodeSelection(params: URLSearchParams): RangeSelection {
  const from = params.get('from')
  const to = params.get('to')
  if (from && to && ISO.test(from) && ISO.test(to) && from < to) return { kind: 'custom', start: from, end: to }
  const r = params.get('range')
  const p = PRESETS.find((x) => x.key === r)
  return p ? { kind: 'preset', preset: p.key } : DEFAULT_SELECTION
}

import type { UseQueryResult } from '@tanstack/react-query'
import { STAGE_CODE, SIGNAL } from '@/core/color'
import type { Column, MetricDef, Range, Raster } from '@/core/domain'
import { formatMetric, unitSuffix } from '@/core/format'
import { isNum, unwrapEvening } from '@/core/stats'
import { addDays, clock, dayRange, daysBetween, type IsoDate } from '@/core/time'

/** A columnar source (nights or daily) re-indexed onto every calendar day of the range, so day charts share one x. */
export interface DayTable {
  days: IsoDate[]
  cols: Record<string, Column>
  /** source rows that fell inside the range (nights or days with data) */
  rows: number
}

export function alignDays(range: Range, rowDays: readonly string[], columns: Record<string, Column>, keys: readonly string[]): DayTable {
  const days = dayRange(range.start, range.end)
  const cols: Record<string, Column> = {}
  for (const k of keys) cols[k] = new Array<number | null>(days.length).fill(null)
  let rows = 0
  rowDays.forEach((d, i) => {
    const at = daysBetween(range.start, d)
    if (at < 0 || at >= days.length) return
    rows++
    for (const k of keys) cols[k][at] = columns[k]?.[i] ?? null
  })
  return { days, cols, rows }
}

/** Clock hours on a noon-to-noon scale (12..36), so 23:30 and 00:30 stay adjacent. */
export const eveningClock = (h: number | null): number | null => (isNum(h) ? unwrapEvening(((h % 24) + 24) % 24) : null)

export const fmtValue = (d: MetricDef) => (v: number | null) => {
  const s = formatMetric(d, v)
  return v == null ? s : s + unitSuffix(d)
}

export const count = (xs: Column) => xs.filter(isNum).length

/** The query states every figure distinguishes. */
export type Loadable<T> = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; data: T; fetching: boolean }

export function loadable<T>(q: UseQueryResult<T>): Loadable<T> {
  if (q.data !== undefined) return { kind: 'ready', data: q.data, fetching: q.isFetching && q.isPlaceholderData }
  return q.isError ? { kind: 'error' } : { kind: 'loading' }
}

export const STAGE_ROWS = [
  { code: STAGE_CODE.unworn, label: 'Not worn', color: SIGNAL.unworn },
  { code: STAGE_CODE.worn, label: 'Awake, worn', color: SIGNAL.worn },
  { code: STAGE_CODE.awake, label: 'Awake in bed', color: SIGNAL.awake },
  { code: STAGE_CODE.core, label: 'Core', color: SIGNAL.core },
  { code: STAGE_CODE.rem, label: 'REM', color: SIGNAL.rem },
  { code: STAGE_CODE.deep, label: 'Deep', color: SIGNAL.deep },
] as const

/** Display row i is the night of day i: the afternoon of day i followed by the morning of day i + 1. */
export interface Actogram {
  rows: number
  data: Uint8Array
  /** the night date D of each display row */
  nights: IsoDate[]
  wornShare: number
  sleptNights: number
}

const HALF = 720
const DAY = 1440

export function noonToNoon(r: Raster): Actogram | null {
  if (!(r.data instanceof Uint8Array) || r.cols !== DAY || r.rows < 2) return null
  const rows = r.rows - 1
  const data = new Uint8Array(rows * DAY)
  let worn = 0
  let slept = 0
  for (let i = 0; i < rows; i++) {
    data.set(r.data.subarray(i * DAY + HALF, (i + 1) * DAY), i * DAY)
    data.set(r.data.subarray((i + 1) * DAY, (i + 1) * DAY + HALF), i * DAY + HALF)
    let asleep = false
    for (let c = i * DAY; c < (i + 1) * DAY; c++) {
      const v = data[c]
      if (v !== STAGE_CODE.unworn) worn++
      if (v >= STAGE_CODE.core) asleep = true
    }
    if (asleep) slept++
  }
  return {
    rows,
    data,
    nights: Array.from({ length: rows }, (_, i) => addDays(r.start, i)),
    wornShare: worn / data.length,
    sleptNights: slept,
  }
}

/** Calendar date and wall-clock label of a display cell. */
export function actogramCell(a: Actogram, row: number, col: number): { date: IsoDate; time: string; code: number } {
  const date = col < HALF ? a.nights[row] : addDays(a.nights[row], 1)
  return { date, time: clock(12 + col / 60), code: a.data[row * DAY + col] }
}

/** 96 quarter-hour bins rotated to start at noon, cropped to the hours that hold data. */
export interface ClockHistogram {
  key: 'onset' | 'mid' | 'wake'
  /** bin start in evening clock hours (12..36) */
  hours: number[]
  counts: number[]
  meanHour: number | null
  r: number | null
}

export function rotateHistogram(counts: readonly number[]): { hours: number[]; counts: number[] } {
  const n = counts.length
  const binH = 24 / n
  const offset = Math.round(12 / binH)
  const hours: number[] = []
  const out: number[] = []
  for (let j = 0; j < n; j++) {
    hours.push(12 + j * binH)
    out.push(counts[(j + offset) % n] ?? 0)
  }
  return { hours, counts: out }
}

/** Hour window [from, to] (even hours) covering every non-empty bin, padded by an hour. */
export function occupiedWindow(hists: readonly ClockHistogram[], binH: number): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const h of hists)
    h.counts.forEach((c, j) => {
      if (c <= 0) return
      lo = Math.min(lo, h.hours[j])
      hi = Math.max(hi, h.hours[j] + binH)
    })
  if (lo === Infinity) return [12, 36]
  return [Math.max(12, Math.floor((lo - 1) / 2) * 2), Math.min(36, Math.ceil((hi + 1) / 2) * 2)]
}

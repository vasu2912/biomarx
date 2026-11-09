import type { Correlation, Daily, StateMatrix } from '@/core/domain'
import { isNum, quantileSorted } from '@/core/stats'
import type { IsoDate } from '@/core/time'

export const ALPHA = 0.05

/** Pairs that correlate by construction (one is computed from the other); never headline them. */
const DERIVED: readonly Pair[] = [
  { a: 'onset_h', b: 'mid_h' },
  { a: 'offset_h', b: 'mid_h' },
  { a: 'eff', b: 'waso' },
  { a: 'dip', b: 'night_hr' },
]
export const Z_CLAMP = 3

/** x = a, y = b in the scatter; a is the matrix column, b the row. */
export interface Pair {
  a: string
  b: string
}

export interface Cell {
  /** position in the strictly-lower triangle: row r is metric r+1, col c is metric c */
  row: number
  col: number
  a: string
  b: string
  rho: number | null
  q: number | null
  n: number | null
  sig: boolean
}

export interface CorrModel {
  metrics: string[]
  cells: Cell[]
  pos: Cell | null
  neg: Cell | null
  strongest: Cell | null
  nSig: number
  tested: number
}

export function corrModel(c: Correlation): CorrModel {
  const m = c.metrics
  const cells: Cell[] = []
  for (let i = 1; i < m.length; i++)
    for (let j = 0; j < i; j++) {
      const rho = c.rho[i]?.[j] ?? null
      const q = c.q[i]?.[j] ?? null
      cells.push({ row: i - 1, col: j, a: m[j], b: m[i], rho, q, n: c.n[i]?.[j] ?? null, sig: isNum(rho) && isNum(q) && q < ALPHA })
    }
  const sig = cells.filter((x) => x.sig)
  const informative = sig.filter((x) => !DERIVED.some((d) => samePair(d, x)))
  const best = (score: (r: number) => number) =>
    informative.reduce<Cell | null>((acc, x) => (score(x.rho!) > (acc ? score(acc.rho!) : 0) ? x : acc), null)
  return {
    metrics: m,
    cells,
    pos: best((r) => r),
    neg: best((r) => -r),
    strongest: best(Math.abs),
    nSig: sig.length,
    tested: cells.filter((x) => isNum(x.rho)).length,
  }
}

export const samePair = (p: Pair, c: Pair) => (p.a === c.a && p.b === c.b) || (p.a === c.b && p.b === c.a)

export const cellOf = (m: CorrModel, p: Pair) => m.cells.find((c) => samePair(c, p)) ?? null

/** The partner with the largest |rho| for one metric, for when a row pick would pair a metric with itself. */
export function strongestPartner(m: CorrModel, key: string): string | null {
  let best: Cell | null = null
  for (const c of m.cells) {
    if ((c.a !== key && c.b !== key) || !isNum(c.rho)) continue
    if (!best || Math.abs(c.rho) > Math.abs(best.rho!)) best = c
  }
  return best ? (best.a === key ? best.b : best.a) : null
}

export function formatQ(q: number | null): string {
  if (!isNum(q)) return 'q —'
  return q < 0.001 ? 'q < 0.001' : `q = ${q.toFixed(3)}`
}

export const formatRho = (r: number | null) => (isNum(r) ? `${r < 0 ? '−' : ''}${Math.abs(r).toFixed(2)}` : '—')

export interface Pt {
  day: IsoDate
  x: number
  y: number
}

export function pairPoints(d: Daily, p: Pair): Pt[] {
  const xs = d.columns[p.a] ?? []
  const ys = d.columns[p.b] ?? []
  const out: Pt[] = []
  d.days.forEach((day, i) => {
    const x = xs[i]
    const y = ys[i]
    if (isNum(x) && isNum(y)) out.push({ day, x, y })
  })
  return out
}

/** Medians of x and y within equal-count bins along x: a monotone trend that matches what Spearman measures. */
export function binnedMedian(pts: readonly Pt[], bins = 8): { x: number; y: number }[] {
  const k = Math.min(bins, Math.floor(pts.length / 6))
  if (k < 2) return []
  const sorted = [...pts].sort((a, b) => a.x - b.x)
  const out: { x: number; y: number }[] = []
  for (let b = 0; b < k; b++) {
    const chunk = sorted.slice(Math.floor((b * sorted.length) / k), Math.floor(((b + 1) * sorted.length) / k))
    const xs = chunk.map((p) => p.x)
    const ys = chunk.map((p) => p.y).sort((u, v) => u - v)
    out.push({ x: quantileSorted(xs, 0.5), y: quantileSorted(ys, 0.5) })
  }
  return out
}

export interface StateGrid {
  days: IsoDate[]
  metrics: string[]
  rows: number
  cols: number
  /** row-major, NaN where missing */
  z: Float32Array
  /** share of cells beyond ±2 per metric */
  extreme: number[]
}

export function stateGrid(s: StateMatrix): StateGrid {
  const rows = s.metrics.length
  const cols = s.days.length
  const z = new Float32Array(rows * cols).fill(NaN)
  const extreme: number[] = []
  for (let r = 0; r < rows; r++) {
    let n = 0
    let far = 0
    for (let c = 0; c < cols; c++) {
      const v = s.z[r]?.[c]
      if (!isNum(v)) continue
      z[r * cols + c] = v
      n++
      if (Math.abs(v) > 2) far++
    }
    extreme.push(n ? far / n : 0)
  }
  return { days: s.days, metrics: s.metrics, rows, cols, z, extreme }
}

import type { EcgDetail, EcgSummary } from '@/core/domain'
import { SIGNAL } from '@/core/color'
import { isNum } from '@/core/stats'

export const TRACE_COLOR = SIGNAL.awake
export const PEAK_COLOR = SIGNAL.sun
export const RR_COLOR = SIGNAL.awake
export const ELLIPSE_COLOR = SIGNAL.hrv

/** One recording, parsed for drawing. Voltages are in mV as served; missing samples are NaN. */
export interface EcgModel {
  summary: EcgSummary
  fs: number
  trace: Float32Array
  peaks: number[]
  /** RR intervals in ms, one fewer than peaks */
  rri: number[]
  sd1: number | null
  sd2: number | null
  beatMs: number[]
  beatMedian: number[]
  beats: number[][]
}

const num = (v: number | null | undefined) => (isNum(v) ? v : NaN)

export function toModel(d: EcgDetail): EcgModel {
  return {
    summary: d.summary,
    fs: d.summary.sample_rate,
    trace: Float32Array.from(d.trace, num),
    peaks: d.peaks,
    rri: d.rri.filter(isNum),
    sd1: d.sd1,
    sd2: d.sd2,
    beatMs: d.beat_ms.map(num),
    beatMedian: d.beat_median.map(num),
    beats: d.beats.map((b) => b.map(num)),
  }
}

export const toUv = (mv: number) => mv * 1000

export function recordedLabel(iso: string, withTime = true): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return withTime ? `${date}, ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}` : date
}

export type ClassTone = 'good' | 'bad' | 'neutral'

/** Apple's classifier labels; anything unrecognised reads as neutral. */
export function classTone(c: string): ClassTone {
  const s = c.toLowerCase()
  if (s.includes('sinus')) return 'good'
  if (s.includes('atrial') || s.includes('fibrillation')) return 'bad'
  return 'neutral'
}

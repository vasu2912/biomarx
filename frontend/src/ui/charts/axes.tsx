import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { SIGNAL } from '@/core/color'
import { hourTick, monthStarts, type IsoDate } from '@/core/time'

export const AX = {
  font: 10,
  label: SIGNAL.ink3,
  labelStrong: SIGNAL.ink2,
  grid: 'rgba(236,234,228,0.055)',
  rule: 'rgba(236,234,228,0.14)',
}

export interface Margin {
  top: number
  right: number
  bottom: number
  left: number
}

/** Measures the content width of its container; charts are always laid out to the real width. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(el)
    setW(Math.floor(el.getBoundingClientRect().width))
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export function ChartSurface({ height, children, className }: { height: number; children: (width: number) => ReactNode; className?: string }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  return (
    <div ref={ref} className={className} style={{ height, position: 'relative' }}>
      {w > 0 && children(w)}
    </div>
  )
}

/**
 * The observatory's time-of-day axis. Every chart with a clock axis uses it: mono ticks, majors at
 * 00/06/12/18, and a thin day/night strip so the reader always sees where the night falls.
 */
export function HourAxis({
  x,
  from,
  to,
  y,
  step = 2,
  strip = true,
  orientation = 'bottom',
}: {
  /** maps clock hours (may exceed 24) to px */
  x: (h: number) => number
  from: number
  to: number
  y: number
  step?: number
  strip?: boolean
  orientation?: 'bottom' | 'top'
}) {
  const ticks: number[] = []
  for (let h = Math.ceil(from / step) * step; h <= to + 1e-9; h += step) ticks.push(h)
  const dir = orientation === 'bottom' ? 1 : -1
  const gid = useId()
  const stops: { o: number; c: string }[] = []
  for (let h = from; h <= to; h += 0.5) {
    const v = ((h % 24) + 24) % 24
    const sun = Math.max(0, Math.cos(((v - 13) / 24) * 2 * Math.PI))
    stops.push({ o: (h - from) / (to - from), c: sun > 0.25 ? `rgba(244,185,74,${0.15 + sun * 0.4})` : `rgba(76,91,255,${0.55 - sun})` })
  }
  return (
    <g aria-hidden>
      {strip && (
        <>
          <defs>
            <linearGradient id={gid} x1="0" x2="1">
              {stops.map((s, i) => (
                <stop key={i} offset={s.o} stopColor={s.c} />
              ))}
            </linearGradient>
          </defs>
          <rect x={x(from)} width={x(to) - x(from)} y={dir > 0 ? y + 1 : y - 3} height={2} fill={`url(#${gid})`} rx={1} />
        </>
      )}
      {ticks.map((h) => {
        const major = h % 6 === 0
        return (
          <g key={h} transform={`translate(${x(h)},${y})`}>
            <line y1={dir * 4} y2={dir * (major ? 9 : 7)} stroke={major ? AX.rule : AX.grid} />
            <text
              y={dir > 0 ? 20 : -12}
              textAnchor="middle"
              fontSize={AX.font}
              fill={major ? AX.labelStrong : AX.label}
            >
              {hourTick(h)}
            </text>
          </g>
        )
      })}
    </g>
  )
}

/** Keep ticks apart by at least `gap(previous)` px; first one wins. */
function spaced<T>(items: readonly T[], pos: (t: T) => number, gap: (prev: T) => number): T[] {
  const out: T[] = []
  for (const it of items) {
    const prev = out[out.length - 1]
    if (prev !== undefined && pos(it) - pos(prev) < gap(prev)) continue
    out.push(it)
  }
  return out
}

/** Mono tick labels are ~0.62em per glyph. */
const labelWidth = (text: string) => text.length * AX.font * 0.62

/** Vertical day axis for rasters: month labels at the first row of each month. */
export function DayAxisLeft({ days, y, x, rowH }: { days: readonly IsoDate[]; y: (row: number) => number; x: number; rowH: number }) {
  const shown = spaced(monthStarts(days), (m) => y(m.index) + rowH / 2, () => 14)
  return (
    <g aria-hidden>
      {shown.map(({ index, label }) => {
        const yy = y(index) + rowH / 2
        const strong = label.includes(' ')
        return (
          <g key={index} transform={`translate(${x},${yy})`}>
            <line x1={-4} x2={0} stroke={AX.rule} />
            <text x={-8} dy="0.32em" textAnchor="end" fontSize={AX.font} fill={strong ? AX.labelStrong : AX.label}>
              {label}
            </text>
          </g>
        )
      })}
    </g>
  )
}

/** Horizontal day axis for time series: month ticks (years emphasised). */
export function DayAxisBottom({ days, x, y, minGap = 34 }: { days: readonly IsoDate[]; x: (i: number) => number; y: number; minGap?: number }) {
  const shown = spaced(monthStarts(days), (m) => x(m.index), (m) => Math.max(minGap, labelWidth(m.label) + 10))
  return (
    <g aria-hidden>
      {shown.map(({ index, label }) => {
        const xx = x(index)
        const strong = label.includes(' ')
        return (
          <g key={index} transform={`translate(${xx},${y})`}>
            <line y1={0} y2={5} stroke={AX.rule} />
            <text y={17} x={2} textAnchor="start" fontSize={AX.font} fill={strong ? AX.labelStrong : AX.label}>
              {label}
            </text>
          </g>
        )
      })}
    </g>
  )
}

export function ValueAxis({
  ticks,
  y,
  x,
  width,
  format,
  grid = true,
  side = 'left',
}: {
  ticks: number[]
  y: (v: number) => number
  x: number
  width: number
  format: (v: number) => string
  grid?: boolean
  side?: 'left' | 'right'
}) {
  return (
    <g aria-hidden>
      {ticks.map((t) => (
        <g key={t} transform={`translate(0,${y(t)})`}>
          {grid && <line x1={x} x2={x + width} stroke={AX.grid} />}
          <text
            x={side === 'left' ? x - 8 : x + width + 8}
            dy="0.32em"
            textAnchor={side === 'left' ? 'end' : 'start'}
            fontSize={AX.font}
            fill={AX.label}
          >
            {format(t)}
          </text>
        </g>
      ))}
    </g>
  )
}

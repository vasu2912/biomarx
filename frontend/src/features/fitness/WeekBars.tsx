import { scaleBand, scaleLinear } from 'd3-scale'
import { useState, type ReactNode } from 'react'
import { SIGNAL, withAlpha } from '@/core/color'
import { addDays, formatDate, monthLabel, type IsoDate } from '@/core/time'
import { AX, ChartSurface, ValueAxis } from '@/ui/charts/axes'
import { HoverCard, type HoverRow } from '@/ui/charts/HoverCard'

const MARGIN = { top: 18, right: 14, bottom: 30, left: 48 }
const BAR_MAX = 18

export interface WeekStack {
  key: string
  label: string
  color: string
  values: readonly (number | null)[]
}

export interface WeekRef {
  y: number
  label: string
}

/** Column path with rounded top corners and a square foot, as in the weekday bars of Mobility. */
function barPath(x: number, w: number, top: number, base: number): string {
  const r = Math.min(3, w / 2, Math.max(0, base - top))
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`
}

/** [start, end) index runs where `flags` is true, so adjacent missing weeks shade as one block without seams. */
function runs(flags: readonly boolean[]): [number, number][] {
  const out: [number, number][] = []
  flags.forEach((f, i) => {
    if (!f) return
    const last = out[out.length - 1]
    if (last && last[1] === i) last[1] = i + 1
    else out.push([i, i + 1])
  })
  return out
}

/** Month labels at the first week whose Thursday (the ISO week's anchor) falls in a new month. */
function WeekAxis({ weeks, x, y }: { weeks: readonly IsoDate[]; x: (i: number) => number; y: number }) {
  const ticks: { i: number; label: string }[] = []
  let prev = ''
  weeks.forEach((w, i) => {
    const thu = addDays(w, 3)
    const m = thu.slice(0, 7)
    if (m === prev) return
    prev = m
    const label = monthLabel(thu, thu.slice(5, 7) === '01' || ticks.length === 0)
    const last = ticks[ticks.length - 1]
    if (last && x(i) - x(last.i) < Math.max(34, last.label.length * AX.font * 0.62 + 10)) return
    ticks.push({ i, label })
  })
  return (
    <g aria-hidden>
      {ticks.map(({ i, label }) => (
        <g key={i} transform={`translate(${x(i)},${y})`}>
          <line y1={0} y2={5} stroke={AX.rule} />
          <text y={17} x={2} fontSize={AX.font} fill={label.includes(' ') ? AX.labelStrong : AX.label}>
            {label}
          </text>
        </g>
      ))}
    </g>
  )
}

/**
 * Weekly columns, stacked bottom-up in `stacks` order. A week whose first stack is null has nothing measured and is shaded
 * as missing rather than drawn as zero.
 */
export function WeekBars({
  weeks,
  weekDays,
  stacks,
  refLines = [],
  domainMax,
  height = 240,
  format,
  label,
  hover,
}: {
  weeks: readonly IsoDate[]
  weekDays: readonly number[]
  stacks: readonly WeekStack[]
  refLines?: readonly WeekRef[]
  domainMax?: number
  height?: number
  format: (v: number) => string
  label: string
  hover: (k: number) => { rows: HoverRow[]; footer?: ReactNode }
}) {
  const [hi, setHi] = useState<number | null>(null)
  const totals = weeks.map((_, k) => stacks.reduce((s, st) => s + (st.values[k] ?? 0), 0))
  const missing = weeks.map((_, k) => stacks[0].values[k] == null)
  const top = Math.max(domainMax ?? 0, ...totals, ...refLines.map((r) => r.y * 1.08))
  return (
    <ChartSurface height={height}>
      {(width) => {
        const innerW = width - MARGIN.left - MARGIN.right
        const innerH = height - MARGIN.top - MARGIN.bottom
        const x = scaleBand<number>().domain(weeks.map((_, i) => i)).range([0, innerW]).padding(0.22)
        const y = scaleLinear().domain([0, top || 1]).range([innerH, 0]).nice(4)
        const bw = Math.min(BAR_MAX, x.bandwidth())
        const cx = (i: number) => x(i)! + x.bandwidth() / 2
        const step = x.step()
        const h = hi != null ? hover(hi) : null
        const partial = hi != null && weekDays[hi] < 7
        return (
          <>
            <svg width={width} height={height} role="img" aria-label={label} className="overflow-visible">
              <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
                {runs(missing).map(([a, b]) => (
                  <rect key={a} x={cx(a) - step / 2} width={(b - a) * step} height={innerH} fill={withAlpha(SIGNAL.ink, 0.022)} />
                ))}
                <ValueAxis ticks={y.ticks(4)} y={y} x={0} width={innerW} format={format} />
                {weeks.map((w, i) => {
                  let base = 0
                  return (
                    <g key={w} opacity={hi == null || hi === i ? 1 : 0.45}>
                      {stacks.map((st) => {
                        const v = st.values[i] ?? 0
                        if (v <= 0) return null
                        const a = y(base)
                        base += v
                        const isTop = st === stacks.findLast((s) => (s.values[i] ?? 0) > 0)
                        return isTop ? (
                          <path key={st.key} d={barPath(cx(i) - bw / 2, bw, y(base), a)} fill={st.color} fillOpacity={0.9} />
                        ) : (
                          <rect key={st.key} x={cx(i) - bw / 2} width={bw} y={y(base)} height={a - y(base)} fill={st.color} fillOpacity={0.9} />
                        )
                      })}
                    </g>
                  )
                })}
                {refLines.map((r) => (
                  <g key={r.label} pointerEvents="none">
                    <line x1={0} x2={innerW} y1={y(r.y)} y2={y(r.y)} stroke={AX.labelStrong} strokeOpacity={0.55} strokeDasharray="2 3" />
                    <text x={innerW - 4} y={y(r.y) - 5} textAnchor="end" fontSize={9.5} fill={AX.labelStrong}>
                      {r.label}
                    </text>
                  </g>
                ))}
                <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke={AX.rule} />
                <WeekAxis weeks={weeks} x={(i) => cx(i) - step / 2} y={innerH} />
                {hi != null && <rect x={cx(hi) - step / 2} width={step} height={innerH} fill={withAlpha(SIGNAL.ink, 0.04)} pointerEvents="none" />}
                {weeks.map((w, i) => (
                  <rect key={w} x={cx(i) - step / 2} width={step} height={innerH} fill="transparent" onPointerEnter={() => setHi(i)} onPointerLeave={() => setHi(null)} />
                ))}
              </g>
            </svg>
            {h && hi != null && (
              <HoverCard
                x={MARGIN.left + cx(hi)}
                y={MARGIN.top}
                containerW={width}
                title={`Week of ${formatDate(weeks[hi], { year: true })}${partial ? ` · ${weekDays[hi]} of 7 days` : ''}`}
                rows={h.rows}
                footer={h.footer}
              />
            )}
          </>
        )
      }}
    </ChartSurface>
  )
}

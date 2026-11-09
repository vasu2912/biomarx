import { scaleLinear } from 'd3-scale'
import { area, line } from 'd3-shape'
import { memo, useMemo, useState, type ReactNode } from 'react'
import { useUi } from '@/app/store'
import { withAlpha } from '@/core/color'
import { extent, isNum, rollingBand, type Band } from '@/core/stats'
import { formatDate, type IsoDate } from '@/core/time'
import { AX, DayAxisBottom, useWidth, ValueAxis, type Margin } from './axes'
import { HoverCard } from './HoverCard'

export interface BandSeriesSpec {
  key: string
  label: string
  color: string
  values: readonly (number | null)[]
  /** rolling window in days; 0 draws dots only */
  window?: number
  /** points only (no band), e.g. M10/L5 timing */
  dotsOnly?: boolean
}

export interface RefLine {
  y: number
  label: string
}
export interface RefBand {
  from: number
  to: number
  label: string
}

const DEFAULT_MARGIN: Margin = { top: 10, right: 14, bottom: 26, left: 44 }

function dotPath(xs: number[], ys: (number | null)[], r: number): string {
  let d = ''
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i]
    if (y == null) continue
    d += `M${xs[i] - r},${y}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`
  }
  return d
}

/**
 * The house time-series form: faint daily dots, a centered rolling median, and its IQR ribbon.
 * The hovered day is shared page-wide through the UI store.
 */
export const BandChart = memo(function BandChart({
  days,
  series,
  height = 200,
  domain,
  ticks: tickCount = 4,
  format = (v: number) => String(Math.round(v * 10) / 10),
  valueFormat,
  refLines = [],
  refBands = [],
  invert = false,
  margin = DEFAULT_MARGIN,
  xAxis = true,
  label,
  annotate,
}: {
  days: readonly IsoDate[]
  series: readonly BandSeriesSpec[]
  height?: number
  domain?: [number, number]
  ticks?: number | number[]
  format?: (v: number) => string
  valueFormat?: (v: number | null) => string
  refLines?: RefLine[]
  refBands?: RefBand[]
  invert?: boolean
  margin?: Margin
  xAxis?: boolean
  label: string
  annotate?: (g: { x: (i: number) => number; y: (v: number) => number; innerW: number; innerH: number }) => ReactNode
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const hoverDay = useUi((s) => s.hoverDay)
  const setHoverDay = useUi((s) => s.setHoverDay)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)

  const bands = useMemo(
    () => series.map((s): Band | null => (s.dotsOnly || s.window === 0 ? null : rollingBand(s.values, s.window ?? 14))),
    [series],
  )

  const n = days.length
  const innerW = Math.max(0, width - margin.left - margin.right)
  const innerH = height - margin.top - margin.bottom
  const x = (i: number) => ((i + 0.5) / Math.max(1, n)) * innerW

  const dom = useMemo<[number, number]>(() => {
    if (domain) return domain
    const all: (number | null)[] = []
    series.forEach((s, k) => {
      const b = bands[k]
      if (b) all.push(...b.lo, ...b.hi)
      // dots can be outliers; bound by the 2-98% range so one bad day doesn't flatten the band
      const v = s.values.filter(isNum).sort((a, b) => a - b)
      if (v.length) all.push(v[Math.floor(v.length * 0.02)], v[Math.floor(v.length * 0.98)])
    })
    refLines.forEach((r) => all.push(r.y))
    return extent(all, 0.08) ?? [0, 1]
  }, [domain, series, bands, refLines])

  const yScale = useMemo(() => {
    const s = scaleLinear().domain(dom).range(invert ? [0, innerH] : [innerH, 0])
    return domain ? s : s.nice(typeof tickCount === 'number' ? tickCount : 4)
  }, [dom, innerH, invert, domain, tickCount])
  const y = (v: number) => yScale(v)
  const ticks = Array.isArray(tickCount) ? tickCount : yScale.ticks(tickCount)
  const [y0, y1] = yScale.domain()
  const inDom = (v: number) => v >= Math.min(y0, y1) && v <= Math.max(y0, y1)

  const xs = useMemo(() => days.map((_, i) => ((i + 0.5) / Math.max(1, days.length)) * innerW), [days, innerW])

  const paths = useMemo(() => {
    const ln = line<number | null>()
      .defined((v) => v != null)
      .x((_, i) => xs[i])
      .y((v) => yScale(v!))
    const ar = area<number>()
      .defined((i) => bandsLo(i) != null)
      .x((i) => xs[i])
      .y0((i) => yScale(bandsLo(i)!))
      .y1((i) => yScale(bandsHi(i)!))
    let cur: Band | null = null
    const bandsLo = (i: number) => cur?.lo[i] ?? null
    const bandsHi = (i: number) => cur?.hi[i] ?? null
    const idx = days.map((_, i) => i)
    return series.map((s, k) => {
      cur = bands[k]
      const dotR = s.dotsOnly ? 1.9 : 1.35
      return {
        dots: dotPath(
          xs,
          s.values.map((v) => (isNum(v) && inDom(v) ? yScale(v) : null)),
          dotR,
        ),
        median: cur ? ln(cur.median) ?? '' : '',
        iqr: cur ? ar(idx) ?? '' : '',
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, bands, xs, yScale, days])

  const hi = hoverDay ? days.indexOf(hoverDay) : -1
  const fmtV = valueFormat ?? ((v: number | null) => (v == null ? '—' : format(v)))

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const i = Math.max(0, Math.min(n - 1, Math.floor((px / innerW) * n)))
    setPointer({ x: px + margin.left, y: e.clientY - rect.top + margin.top })
    setHoverDay(days[i])
  }

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} className="overflow-visible">
          <g transform={`translate(${margin.left},${margin.top})`}>
            {refBands.map((b) => (
              <g key={b.label}>
                <rect x={0} width={innerW} y={Math.min(y(b.from), y(b.to))} height={Math.abs(y(b.to) - y(b.from))} fill="rgba(65,207,195,0.05)" />
                <text x={6} y={Math.min(y(b.from), y(b.to)) + 12} fontSize={9.5} fill={AX.label}>
                  {b.label}
                </text>
              </g>
            ))}
            <ValueAxis ticks={ticks} y={y} x={0} width={innerW} format={format} />
            {refLines.map((r) => (
              <g key={r.label}>
                <line x1={0} x2={innerW} y1={y(r.y)} y2={y(r.y)} stroke={AX.rule} strokeDasharray="1 3" />
                <text x={innerW - 4} y={y(r.y) - 5} textAnchor="end" fontSize={9.5} fill={AX.label}>
                  {r.label}
                </text>
              </g>
            ))}
            {series.map((s, k) => (
              <g key={s.key}>
                {paths[k].iqr && <path d={paths[k].iqr} fill={withAlpha(s.color, 0.13)} />}
                <path d={paths[k].dots} fill={withAlpha(s.color, s.dotsOnly ? 0.7 : 0.32)} />
                {paths[k].median && (
                  <path d={paths[k].median} fill="none" stroke={s.color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
                )}
              </g>
            ))}
            {annotate?.({ x, y, innerW, innerH })}
            {xAxis && <DayAxisBottom days={days} x={(i) => (i / Math.max(1, n)) * innerW} y={innerH + 4} />}
            {hi >= 0 && (
              <g pointerEvents="none">
                <line x1={x(hi)} x2={x(hi)} y1={0} y2={innerH} stroke={AX.rule} />
                {series.map((s, k) => {
                  const v = bands[k]?.median[hi] ?? s.values[hi]
                  return isNum(v) && inDom(v) ? <circle key={s.key} cx={x(hi)} cy={y(v)} r={3.5} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} /> : null
                })}
              </g>
            )}
            <rect
              width={innerW}
              height={innerH}
              fill="transparent"
              onPointerMove={onMove}
              onPointerLeave={() => {
                setPointer(null)
                setHoverDay(null)
              }}
            />
          </g>
        </svg>
      )}
      {pointer && hi >= 0 && (
        <HoverCard
          x={pointer.x}
          y={pointer.y}
          containerW={width}
          title={formatDate(days[hi], { weekday: true, year: true })}
          rows={series.map((s, k) => ({
            label: s.label,
            color: s.color,
            value: fmtV(s.values[hi] ?? null),
            sub: bands[k] ? `${fmtV(bands[k]!.median[hi])} ${s.window ?? 14}d` : undefined,
          }))}
        />
      )}
    </div>
  )
})

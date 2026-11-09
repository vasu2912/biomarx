import { scaleBand, scaleLinear } from 'd3-scale'
import { area, curveStepAfter, line } from 'd3-shape'
import { useMemo, useState } from 'react'
import { useObservatory } from '@/app/context'
import { SIGNAL, withAlpha } from '@/core/color'
import type { Daily, Raster } from '@/core/domain'
import { compact, fixed } from '@/core/format'
import { K } from '@/core/metrics'
import { isNum, quantile } from '@/core/stats'
import { clock, weekday, WEEKDAYS } from '@/core/time'
import { useDaily, useRaster } from '@/infra/queries'
import { AX, ChartSurface, HourAxis, ValueAxis } from '@/ui/charts/axes'
import { Figure, FigureSkeleton, Legend } from '@/ui/charts/Figure'
import { HoverCard } from '@/ui/charts/HoverCard'
import { EmptyState } from '@/ui/primitives'

const COLOR = SIGNAL.sun
const HEIGHT = 230
const MARGIN = { top: 18, right: 14, bottom: 30, left: 48 }
const BAR_MAX = 24
const METRICS = [K.steps] as const

interface Bin {
  label: string
  median: number
  lo: number
  hi: number
  n: number
}

function weekdayBins(d: Daily): Bin[] {
  const by: (number | null)[][] = WEEKDAYS.map(() => [])
  const steps = d.columns[K.steps] ?? []
  d.days.forEach((day, i) => by[weekday(day)].push(steps[i] ?? null))
  return WEEKDAYS.map((label, w) => ({
    label,
    median: quantile(by[w], 0.5) ?? 0,
    lo: quantile(by[w], 0.25) ?? 0,
    hi: quantile(by[w], 0.75) ?? 0,
    n: by[w].filter(isNum).length,
  }))
}

/** Hourly totals, not 10-minute bins: most 10-minute bins are still, so their median is zero at every hour. */
function hourlyBins(r: Raster<Float32Array>): Bin[] {
  const per = r.cols / 24
  const out: Bin[] = []
  for (let h = 0; h < 24; h++) {
    const totals: number[] = []
    for (let row = 0; row < r.rows; row++) {
      let s = 0
      let ok = false
      for (let c = h * per; c < (h + 1) * per; c++) {
        const v = r.data[row * r.cols + c]
        if (Number.isFinite(v)) {
          s += v
          ok = true
        }
      }
      if (ok) totals.push(s)
    }
    out.push({ label: clock(h), median: quantile(totals, 0.5) ?? 0, lo: quantile(totals, 0.25) ?? 0, hi: quantile(totals, 0.75) ?? 0, n: totals.length })
  }
  return out
}

/** Column path with 4 px rounded top corners and a square foot on the baseline. */
function barPath(x: number, w: number, top: number, base: number): string {
  const r = Math.min(4, w / 2, Math.max(0, base - top))
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`
}

function PanelHead({ title, unit, stat }: { title: string; unit: string; stat: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-hairline pb-1.5">
      <div className="text-[12.5px] text-ink-2">
        {title}
        <span className="ml-1.5 text-ink-3">{unit}</span>
      </div>
      <div className="num text-[12px] text-ink">{stat}</div>
    </div>
  )
}

function WeekdayBars({ bins }: { bins: Bin[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const top = bins.reduce((b, v, i) => (v.median > bins[b].median ? i : b), 0)
  const low = bins.reduce((b, v, i) => (v.median < bins[b].median ? i : b), 0)
  return (
    <section className="min-w-0">
      <PanelHead title="By weekday" unit="median steps per day" stat={`range ${compact(bins[low].median)}–${compact(bins[top].median)}`} />
      <ChartSurface height={HEIGHT}>
        {(width) => {
          const innerW = width - MARGIN.left - MARGIN.right
          const innerH = HEIGHT - MARGIN.top - MARGIN.bottom
          const x = scaleBand<number>().domain(bins.map((_, i) => i)).range([0, innerW]).padding(0.2)
          const y = scaleLinear().domain([0, Math.max(...bins.map((b) => b.median)) * 1.1 || 1]).range([innerH, 0]).nice(4)
          const bw = Math.min(BAR_MAX, x.bandwidth())
          const cx = (i: number) => x(i)! + x.bandwidth() / 2
          const h = hover != null ? bins[hover] : null
          return (
            <>
              <svg width={width} height={HEIGHT} role="img" aria-label="Median steps by weekday" className="overflow-visible">
                <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
                  <ValueAxis ticks={y.ticks(4)} y={y} x={0} width={innerW} format={compact} />
                  {bins.map((b, i) => (
                    <g key={b.label}>
                      <path d={barPath(cx(i) - bw / 2, bw, y(b.median), innerH)} fill={COLOR} fillOpacity={hover == null || hover === i ? 0.9 : 0.4} />
                      {(i === top || i === low) && (
                        <text x={cx(i)} y={y(b.median) - 6} textAnchor="middle" fontSize={10} fill={AX.labelStrong} className="num">
                          {compact(b.median)}
                        </text>
                      )}
                      <text x={cx(i)} y={innerH + 17} textAnchor="middle" fontSize={AX.font} fill={AX.label}>
                        {b.label}
                      </text>
                      <rect x={x(i)} width={x.bandwidth()} height={innerH} fill="transparent" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
                    </g>
                  ))}
                  <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke={AX.rule} />
                </g>
              </svg>
              {h && hover != null && (
                <HoverCard
                  x={MARGIN.left + cx(hover)}
                  y={MARGIN.top + y(h.median)}
                  containerW={width}
                  title={`${h.label} · ${h.n} days`}
                  rows={[
                    { label: 'median', value: `${fixed(h.median, 0)} steps`, color: COLOR, kind: 'swatch' },
                    { label: 'middle half', value: `${compact(h.lo)}–${compact(h.hi)}` },
                  ]}
                />
              )}
            </>
          )
        }}
      </ChartSurface>
    </section>
  )
}

function HourlyProfile({ bins }: { bins: Bin[] }) {
  const [hover, setHover] = useState<{ h: number; x: number; y: number } | null>(null)
  const peak = bins.reduce((b, v, i) => (v.median > bins[b].median ? i : b), 0)
  const pts = [...bins, bins[bins.length - 1]]
  return (
    <section className="min-w-0">
      <PanelHead title="By time of day" unit="median steps per hour" stat={`peak ${clock(peak)}`} />
      <ChartSurface height={HEIGHT}>
        {(width) => {
          const innerW = width - MARGIN.left - MARGIN.right
          const innerH = HEIGHT - MARGIN.top - MARGIN.bottom
          const x = (h: number) => (h / 24) * innerW
          const y = scaleLinear().domain([0, Math.max(...bins.map((b) => b.hi)) * 1.05 || 1]).range([innerH, 0]).nice(4)
          const band = area<Bin>().curve(curveStepAfter).x((_, i) => x(i)).y0((b) => y(b.lo)).y1((b) => y(b.hi))
          const med = area<Bin>().curve(curveStepAfter).x((_, i) => x(i)).y0(innerH).y1((b) => y(b.median))
          const edge = line<Bin>().curve(curveStepAfter).x((_, i) => x(i)).y((b) => y(b.median))
          const hb = hover ? bins[hover.h] : null
          return (
            <>
              <svg width={width} height={HEIGHT} role="img" aria-label="Median steps by hour of day" className="overflow-visible">
                <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
                  <ValueAxis ticks={y.ticks(4)} y={y} x={0} width={innerW} format={compact} />
                  <path d={band(pts) ?? ''} fill={withAlpha(COLOR, 0.1)} />
                  <path d={med(pts) ?? ''} fill={withAlpha(COLOR, 0.28)} />
                  <path d={edge(pts) ?? ''} fill="none" stroke={COLOR} strokeWidth={1.75} strokeLinejoin="round" />
                  <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke={AX.rule} />
                  <HourAxis x={x} from={0} to={24} y={innerH + 2} step={3} />
                  {hb && hover && (
                    <g pointerEvents="none">
                      <rect x={x(hover.h)} width={x(1)} y={0} height={innerH} fill={withAlpha(SIGNAL.ink, 0.04)} />
                      <line x1={x(hover.h + 0.5)} x2={x(hover.h + 0.5)} y1={0} y2={innerH} stroke={AX.rule} />
                    </g>
                  )}
                  <rect
                    width={innerW}
                    height={innerH}
                    fill="transparent"
                    onPointerMove={(e) => {
                      const r = e.currentTarget.getBoundingClientRect()
                      const lx = e.clientX - r.left
                      setHover({ h: Math.max(0, Math.min(23, Math.floor((lx / innerW) * 24))), x: lx + MARGIN.left, y: e.clientY - r.top + MARGIN.top })
                    }}
                    onPointerLeave={() => setHover(null)}
                  />
                </g>
              </svg>
              {hb && hover && (
                <HoverCard
                  x={hover.x}
                  y={hover.y}
                  containerW={width}
                  title={`${clock(hover.h)}–${clock(hover.h + 1)} · ${hb.n} days`}
                  rows={[
                    { label: 'median', value: `${fixed(hb.median, 0)} steps`, color: COLOR, kind: 'swatch' },
                    { label: 'middle half', value: `${compact(hb.lo)}–${compact(hb.hi)}` },
                  ]}
                />
              )}
            </>
          )
        }}
      </ChartSurface>
    </section>
  )
}

export function WeeklyShapeFigure() {
  const { range } = useObservatory()
  const q = useDaily(range, METRICS)
  const qr = useRaster('steps10', range)
  const week = useMemo(() => (q.data ? weekdayBins(q.data) : null), [q.data])
  const hours = useMemo(() => (qr.data && qr.data.data instanceof Float32Array ? hourlyBins(qr.data as Raster<Float32Array>) : null), [qr.data])

  if (q.isPending || qr.isPending) return <FigureSkeleton height={HEIGHT} />
  const head = {
    index: '6.3',
    title: 'The shape of an ordinary week',
    caption: 'Left, median daily steps for each weekday; right, median steps in each clock hour with the middle half of days shaded.',
    method: {
      body: (
        <>
          <p>Weekday bars take the median of daily step totals falling on that weekday in the range. The hourly profile sums each day’s 10-minute bins into clock hours, then takes the median and interquartile range of those hourly totals across days.</p>
          <p>Medians are used so a single long hike does not set the shape of a typical day.</p>
        </>
      ),
    },
  }
  if (q.isError || qr.isError || !week || !hours || week.every((b) => b.n === 0)) {
    return (
      <Figure {...head}>
        <EmptyState title="No steps in this range">{(q.error ?? qr.error)?.message ?? 'The phone and watch recorded no steps for these days.'}</EmptyState>
      </Figure>
    )
  }
  const top = week.reduce((b, v) => (v.median > b.median ? v : b))
  const low = week.reduce((b, v) => (v.median < b.median ? v : b))
  const peak = hours.reduce((b, v, i) => (v.median > hours[b].median ? i : b), 0)
  return (
    <Figure
      {...head}
      fetching={(q.isPlaceholderData && q.isFetching) || (qr.isPlaceholderData && qr.isFetching)}
      legend={
        <Legend
          items={[
            { label: 'Median', color: COLOR, kind: 'line' },
            { label: 'Middle half of days (hourly)', color: COLOR, kind: 'band' },
          ]}
        />
      }
      reading={
        <>
          {top.label} is the most active day at a median {fixed(top.median, 0)} steps, {fixed(((top.median - low.median) / (low.median || 1)) * 100, 0)}% above {low.label}. Within
          the day, the {clock(peak)} hour carries the most, a median {fixed(hours[peak].median, 0)} steps.
        </>
      }
    >
      <div className="grid gap-x-8 gap-y-10 lg:grid-cols-2">
        <WeekdayBars bins={week} />
        <HourlyProfile bins={hours} />
      </div>
    </Figure>
  )
}

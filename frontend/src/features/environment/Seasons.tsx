import { scaleLinear } from 'd3-scale'
import { area, line } from 'd3-shape'
import { useMemo, useState, type ReactNode } from 'react'
import { withAlpha } from '@/core/color'
import type { Season } from '@/core/domain'
import { isNum } from '@/core/stats'
import { AX, useWidth, ValueAxis, type Margin } from '@/ui/charts/axes'
import { HoverCard, type HoverRow } from '@/ui/charts/HoverCard'
import { Legend, type LegendItem } from '@/ui/charts/Figure'
import { cn } from '@/ui/primitives'

const WEEKS = 53
const MARGIN: Margin = { top: 10, right: 14, bottom: 26, left: 44 }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** Day of the year each month starts on, in a common year. */
const MONTH_DOY = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]

/** ISO week k (0-based) is centred on its Thursday, which falls on about day 7k + 3 of the year. */
const weekOfDoy = (doy: number) => (doy - 3) / 7
export const monthOfWeek = (k: number) => MONTHS[Math.min(11, Math.max(0, MONTH_DOY.findLastIndex((d) => d <= 7 * k + 3)))]

export interface SeasonSeries {
  key: string
  label: string
  color: string
  season: Season
}

export interface SeasonPanel {
  key: string
  title: string
  unit?: string
  stat?: ReactNode
  legend?: LegendItem[]
  series: SeasonSeries[]
  format: (v: number) => string
  valueFormat: (v: number | null) => string
}

function SeasonChart({ panel, hi, setHi, height }: { panel: SeasonPanel; hi: number | null; setHi: (k: number | null) => void; height: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right)
  const innerH = height - MARGIN.top - MARGIN.bottom
  const x = (k: number) => ((k + 0.5) / WEEKS) * innerW

  const y = useMemo(() => {
    const all = panel.series.flatMap((s) => [...s.season.median, ...s.season.q25, ...s.season.q75]).filter(isNum)
    const lo = Math.min(...all)
    const hiV = Math.max(...all)
    const pad = (hiV - lo || Math.abs(hiV) || 1) * 0.08
    // Counts that sit near zero keep a zero floor, as in the daily panels, so minutes never read negative.
    const floor = lo >= 0 && lo <= (hiV - lo) * 0.3 ? 0 : lo - pad
    return scaleLinear()
      .domain([floor, hiV + pad])
      .range([innerH, 0])
      .nice(4)
  }, [panel.series, innerH])

  const paths = useMemo(() => {
    const ln = line<number | null>()
      .defined(isNum)
      .x((_, k) => x(k))
      .y((v) => y(v!))
    return panel.series.map((s) => {
      const ar = area<number>()
        .defined((k) => isNum(s.season.q25[k]) && isNum(s.season.q75[k]))
        .x((k) => x(k))
        .y0((k) => y(s.season.q25[k]!))
        .y1((k) => y(s.season.q75[k]!))
      const dots = s.season.median.map((v, k) => (isNum(v) ? `M${x(k) - 1.6},${y(v)}a1.6,1.6 0 1,0 3.2,0a1.6,1.6 0 1,0 -3.2,0` : '')).join('')
      return { median: ln(s.season.median) ?? '', iqr: ar(Array.from({ length: WEEKS }, (_, k) => k)) ?? '', dots }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.series, y, innerW])

  const ticks = MONTH_DOY.map((d, m) => ({ m, at: x(weekOfDoy(d)) }))
  const shown = innerW < 320 ? ticks.filter((t) => t.m % 3 === 0) : ticks

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    setPointer({ x: px + MARGIN.left, y: e.clientY - rect.top + MARGIN.top })
    setHi(Math.max(0, Math.min(WEEKS - 1, Math.floor((px / innerW) * WEEKS))))
  }

  const rows: HoverRow[] =
    hi == null
      ? []
      : panel.series.map((s) => {
          const q25 = s.season.q25[hi]
          const q75 = s.season.q75[hi]
          const n = s.season.years[hi]
          return {
            label: s.label,
            color: s.color,
            value: panel.valueFormat(s.season.median[hi]),
            sub: isNum(q25) && isNum(q75) ? `${panel.valueFormat(q25)}–${panel.valueFormat(q75)}` : n ? `${n} year` : undefined,
          }
        })
  const years = hi == null ? 0 : Math.max(...panel.series.map((s) => s.season.years[hi]))

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${panel.title} by week of the year`} className="overflow-visible">
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            <ValueAxis ticks={y.ticks(4)} y={y} x={0} width={innerW} format={panel.format} />
            {panel.series.map((s, k) => (
              <g key={s.key}>
                {paths[k].iqr && <path d={paths[k].iqr} fill={withAlpha(s.color, 0.13)} />}
                <path d={paths[k].dots} fill={withAlpha(s.color, 0.6)} />
                {paths[k].median && <path d={paths[k].median} fill="none" stroke={s.color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />}
              </g>
            ))}
            <g aria-hidden>
              {shown.map(({ m, at }) => (
                <g key={m} transform={`translate(${at},${innerH + 4})`}>
                  <line y1={0} y2={5} stroke={AX.rule} />
                  <text y={17} x={2} fontSize={AX.font} fill={AX.label}>
                    {MONTHS[m]}
                  </text>
                </g>
              ))}
            </g>
            {hi != null && (
              <g pointerEvents="none">
                <line x1={x(hi)} x2={x(hi)} y1={0} y2={innerH} stroke={AX.rule} />
                {panel.series.map((s) => {
                  const v = s.season.median[hi]
                  return isNum(v) ? <circle key={s.key} cx={x(hi)} cy={y(v)} r={3.5} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} /> : null
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
                setHi(null)
              }}
            />
          </g>
        </svg>
      )}
      {pointer && hi != null && (
        <HoverCard
          x={pointer.x}
          y={pointer.y}
          containerW={width}
          title={`Week ${hi + 1} · ${monthOfWeek(hi)}`}
          rows={rows}
          footer={years ? `${years} ${years === 1 ? 'year covers' : 'years cover'} this week${years >= 2 ? '; the range is the interquartile range across years' : ''}` : 'no year covers this week'}
        />
      )}
    </div>
  )
}

const COLS = { 2: 'lg:grid-cols-2', 4: 'lg:grid-cols-4' } as const

/** Small multiples over the 53 ISO weeks of the year; hovering one marks the same week in all. */
export function SeasonPanels({ panels, cols = 2, height = 170 }: { panels: readonly SeasonPanel[]; cols?: keyof typeof COLS; height?: number }) {
  const [hi, setHi] = useState<number | null>(null)
  return (
    <div className={cn('grid gap-x-8 gap-y-10 sm:grid-cols-2', COLS[cols])}>
      {panels.map((p) => (
        <section key={p.key} className="min-w-0">
          <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-hairline pb-1.5">
            <div className="text-[12.5px] text-ink-2">
              {p.title}
              {p.unit && <span className="ml-1.5 text-ink-3">{p.unit}</span>}
            </div>
            {p.stat && <div className="num text-[12px] text-ink">{p.stat}</div>}
          </div>
          {p.legend && <Legend items={p.legend} className="mb-1.5 !text-[11px]" />}
          <SeasonChart panel={p} hi={hi} setHi={setHi} height={height} />
        </section>
      ))}
    </div>
  )
}

import { bisector } from 'd3-array'
import { scaleLinear, scaleLog } from 'd3-scale'
import { area, line } from 'd3-shape'
import { useMemo, useState } from 'react'
import { useObservatory } from '@/app/context'
import { SIGNAL, withAlpha } from '@/core/color'
import type { Periodogram } from '@/core/domain'
import { fixed } from '@/core/format'
import { isNum } from '@/core/stats'
import { usePeriodogram } from '@/infra/queries'
import { AX, ChartSurface, ValueAxis } from '@/ui/charts/axes'
import { Figure, FigureSkeleton } from '@/ui/charts/Figure'
import { HoverCard } from '@/ui/charts/HoverCard'
import { EmptyState } from '@/ui/primitives'

const TICKS = [3, 6, 12, 24, 48, 96, 168]
const MARGIN = { top: 22, right: 14, bottom: 28, left: 44 }
const HEIGHT = 230

const SERIES = [
  { key: 'hr', label: 'Heart rate', color: SIGNAL.ember },
  { key: 'steps', label: 'Steps', color: SIGNAL.sun },
] as const
type SeriesKey = (typeof SERIES)[number]['key']

interface Model {
  periods: number[]
  power: Record<SeriesKey, number[]>
  peak: Record<SeriesKey, { period: number; power: number; i: number }>
  /** power at 12 h relative to 24 h, for the reading */
  harmonic: number | null
}

const nearest = bisector<number, number>((d) => d).center

function model(p: Periodogram): Model | null {
  const idx = p.periods.map((_, i) => i).filter((i) => isNum(p.periods[i]))
  if (idx.length < 2) return null
  const periods = idx.map((i) => p.periods[i] as number)
  const pw = (s: readonly (number | null)[]) => idx.map((i) => (isNum(s[i]) ? s[i] : 0))
  const power = { hr: pw(p.hr), steps: pw(p.steps) }
  const argmax = (a: number[]) => a.reduce((b, v, i) => (v > a[b] ? i : b), 0)
  const at = (k: SeriesKey, i: number) => ({ period: periods[i], power: power[k][i], i })
  const domI = p.dominant_hr_period != null ? nearest(periods, p.dominant_hr_period) : argmax(power.hr)
  const p24 = power.hr[nearest(periods, 24)]
  return {
    periods,
    power,
    peak: { hr: at('hr', domI), steps: at('steps', argmax(power.steps)) },
    harmonic: p24 > 0 ? power.hr[nearest(periods, 12)] / p24 : null,
  }
}

const fmtPower = (v: number) => fixed(v, v < 0.1 ? 3 : 2)
const fmtPeriod = (h: number) => (h >= 48 ? `${fixed(h / 24, 1)} d` : `${fixed(h, 1)} h`)

function Panel({ m, k, hover, onHover }: { m: Model; k: SeriesKey; hover: number | null; onHover: (i: number | null) => void }) {
  const s = SERIES.find((x) => x.key === k)!
  const [ptr, setPtr] = useState<{ x: number; y: number } | null>(null)
  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-hairline pb-1.5">
        <div className="text-[12.5px] text-ink-2">
          {s.label}
          <span className="ml-1.5 text-ink-3">normalised power</span>
        </div>
        <div className="num text-[12px] text-ink">peak {fmtPeriod(m.peak[k].period)}</div>
      </div>
      <ChartSurface height={HEIGHT}>
        {(width) => {
          const innerW = width - MARGIN.left - MARGIN.right
          const innerH = HEIGHT - MARGIN.top - MARGIN.bottom
          const x = scaleLog().domain([m.periods[0], m.periods[m.periods.length - 1]]).range([0, innerW])
          const ymax = Math.max(...m.power[k]) || 1
          const y = scaleLinear().domain([0, ymax * 1.12]).range([innerH, 0]).nice(4)
          const ln = line<number>().x((_, i) => x(m.periods[i])).y((v) => y(v))
          const ar = area<number>().x((_, i) => x(m.periods[i])).y0(innerH).y1((v) => y(v))
          const pk = m.peak[k]
          const px = x(pk.period)
          return (
            <>
              <svg width={width} height={HEIGHT} role="img" aria-label={`${s.label} periodogram`} className="overflow-visible">
                <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
                  <ValueAxis ticks={y.ticks(4)} y={y} x={0} width={innerW} format={fmtPower} />
                  <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke={AX.rule} />
                  {TICKS.map((t) => (
                    <g key={t} transform={`translate(${x(t)},${innerH})`}>
                      <line y2={5} stroke={AX.rule} />
                      <text y={17} textAnchor="middle" fontSize={AX.font} fill={t === 24 ? AX.labelStrong : AX.label}>
                        {t} h
                      </text>
                    </g>
                  ))}
                  <line x1={x(24)} x2={x(24)} y1={-6} y2={innerH} stroke={AX.rule} strokeDasharray="1 3" />
                  <text x={x(24) - 4} y={-10} textAnchor="end" fontSize={9.5} fill={AX.label}>
                    24 h
                  </text>
                  <path d={ar(m.power[k]) ?? ''} fill={withAlpha(s.color, 0.1)} />
                  <path d={ln(m.power[k]) ?? ''} fill="none" stroke={s.color} strokeWidth={1.75} strokeLinejoin="round" />
                  <circle cx={px} cy={y(pk.power)} r={4} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />
                  <text x={px + 8} y={y(pk.power) + 3} fontSize={10.5} fill={AX.labelStrong} className="num">
                    {k === 'hr' ? 'dominant ' : 'peak '}
                    {fmtPeriod(pk.period)}
                  </text>
                  {hover != null && (
                    <g pointerEvents="none">
                      <line x1={x(m.periods[hover])} x2={x(m.periods[hover])} y1={0} y2={innerH} stroke={AX.rule} />
                      <circle cx={x(m.periods[hover])} cy={y(m.power[k][hover])} r={3.5} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />
                    </g>
                  )}
                  <rect
                    width={innerW}
                    height={innerH}
                    fill="transparent"
                    onPointerMove={(e) => {
                      const r = e.currentTarget.getBoundingClientRect()
                      const lx = e.clientX - r.left
                      setPtr({ x: lx + MARGIN.left, y: e.clientY - r.top + MARGIN.top })
                      onHover(nearest(m.periods, x.invert(lx)))
                    }}
                    onPointerLeave={() => {
                      setPtr(null)
                      onHover(null)
                    }}
                  />
                </g>
              </svg>
              {ptr && hover != null && (
                <HoverCard
                  x={ptr.x}
                  y={ptr.y}
                  containerW={width}
                  title={`Period ${fmtPeriod(m.periods[hover])}`}
                  rows={SERIES.map((o) => ({ label: o.label, color: o.color, value: fmtPower(m.power[o.key][hover]) }))}
                />
              )}
            </>
          )
        }}
      </ChartSurface>
    </section>
  )
}

export function PeriodogramFigure() {
  const { range } = useObservatory()
  const q = usePeriodogram(range)
  const m = useMemo(() => (q.data ? model(q.data) : null), [q.data])
  const [hover, setHover] = useState<number | null>(null)
  if (q.isPending) return <FigureSkeleton height={HEIGHT} />
  const head = {
    index: '3.5',
    title: 'Periodogram: which cycle lengths carry the signal',
    caption: 'Spectral power by period on a log axis, heart rate and steps on separate scales; a sharp peak at 24 h is a strong circadian rhythm.',
    method: {
      body: (
        <>
          <p>Lomb-Scargle periodogram of hourly heart rate and hourly steps over the selected range, evaluated at 1,200 log-spaced periods from 2.5 h to 16 days. Lomb-Scargle tolerates the gaps left by unworn hours.</p>
          <p>Power is normalised per signal, so compare peak positions across the two panels, not heights.</p>
        </>
      ),
      cite: 'Lomb NR 1976; Scargle JD 1982. Refinetti R, Circadian Physiology, 3rd ed.',
    },
  }
  if (q.isError || !m) {
    return (
      <Figure {...head}>
        <EmptyState title="No periodogram for this range">{q.error?.message ?? 'The range holds too few hours of heart rate or steps.'}</EmptyState>
      </Figure>
    )
  }
  return (
    <Figure
      {...head}
      fetching={q.isPlaceholderData && q.isFetching}
      reading={
        <>
          Heart rate’s dominant period is {fmtPeriod(m.peak.hr.period)} and steps peak at {fmtPeriod(m.peak.steps.period)}
          {m.harmonic != null && <>; the 12 h harmonic carries {fixed(m.harmonic * 100, 0)}% of the 24 h heart-rate power</>}.
        </>
      }
    >
      <div className="grid gap-x-8 gap-y-10 lg:grid-cols-2">
        {SERIES.map((s) => (
          <Panel key={s.key} m={m} k={s.key} hover={hover} onHover={setHover} />
        ))}
      </div>
    </Figure>
  )
}

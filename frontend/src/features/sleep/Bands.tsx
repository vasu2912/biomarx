import { scaleLinear } from 'd3-scale'
import { useMemo } from 'react'
import { useObservatory } from '@/app/context'
import { SIGNAL } from '@/core/color'
import type { MetricDef, Range } from '@/core/domain'
import { def, K, METRIC_COLOR, type Registry } from '@/core/metrics'
import { clockMedian, isNum, median } from '@/core/stats'
import { clock, type IsoDate } from '@/core/time'
import { useDaily, useNights } from '@/infra/queries'
import { BandChart, type BandSeriesSpec } from '@/ui/charts/BandChart'
import { Figure, Legend, type MethodNote } from '@/ui/charts/Figure'
import { EmptyState } from '@/ui/primitives'
import { alignDays, count, eveningClock, fmtValue, loadable, type DayTable, type Loadable } from './data'
import { Frame, PanelLabel } from './Frame'

/**
 * A day-indexed figure drawn with BandChart. `overlay` puts every key on one axis (same unit);
 * `multiples` gives each key its own chart.
 */
export interface BandFigureSpec {
  index: string
  title: string
  caption: string
  method: MethodNote
  source: 'nights' | 'daily'
  layout: 'overlay' | 'multiples'
  keys: readonly string[]
  colors?: Partial<Record<string, string>>
  domain?: [number, number]
  ticks?: number[]
  minRows: number
  reading: (t: DayTable, reg: Registry) => string
}

const med = (t: DayTable, reg: Registry, key: string) => fmtValue(def(reg, key))(median(t.cols[key]))

export const BAND_FIGURES = {
  timing: {
    index: '2.2',
    title: 'When sleep starts, peaks and ends',
    caption: 'Onset, mid-sleep and wake on one clock axis. Dots are nights, the line is a 14-night rolling median, the ribbon its interquartile range.',
    source: 'nights',
    layout: 'overlay',
    keys: [K.onset, K.mid, K.offset],
    minRows: 3,
    reading: (t) =>
      `Median onset ${clock(clockMedian(t.cols[K.onset]))}, mid-sleep ${clock(clockMedian(t.cols[K.mid]))}, wake ${clock(clockMedian(t.cols[K.offset]))}, across ${t.rows} nights.`,
    method: {
      body: (
        <>
          <p>Each night D is its main episode: the longest cluster of asleep segments joined across gaps of at most 60 minutes. A night counts only when total sleep is at least 3 h.</p>
          <p>Clock times are unwrapped onto a noon-to-noon scale so 23:30 and 00:30 sit next to each other. Medians are taken on that scale, never on raw hours.</p>
        </>
      ),
    },
  },
  duration: {
    index: '2.3',
    title: 'How long, and how much of it asleep',
    caption: 'Total sleep, efficiency and minutes awake inside the main episode, each on its own axis.',
    source: 'nights',
    layout: 'multiples',
    keys: [K.tst, K.eff, K.waso],
    colors: { [K.waso]: SIGNAL.awake },
    minRows: 3,
    reading: (t, reg) =>
      `Median total sleep ${med(t, reg, K.tst)}, efficiency ${med(t, reg, K.eff)}, awake in bed ${med(t, reg, K.waso)}, over ${t.rows} nights.`,
    method: {
      body: (
        <>
          <p>Total sleep is the minutes staged Core, REM or Deep inside the main episode. Efficiency is total sleep divided by the episode length. Awake in bed counts the minutes staged Awake between onset and final wake.</p>
          <p>Short naps outside the main episode are not counted.</p>
        </>
      ),
    },
  },
  composition: {
    index: '2.4',
    title: 'Deep and REM as a share of sleep',
    caption: 'Deep and REM minutes as a percentage of total sleep, per night.',
    source: 'nights',
    layout: 'overlay',
    keys: [K.deepPct, K.remPct],
    colors: { [K.deepPct]: SIGNAL.deep, [K.remPct]: SIGNAL.rem },
    minRows: 3,
    reading: (t, reg) => `Deep is a median ${med(t, reg, K.deepPct)} of total sleep and REM ${med(t, reg, K.remPct)}, over ${t.rows} nights.`,
    method: {
      body: <p>Shares are of total sleep (Core + REM + Deep), not of time in bed, so a restless night does not lower them. Stages are the watch's own classification.</p>,
    },
  },
  regularity: {
    index: '2.7',
    title: 'How regular sleep is from day to day',
    caption: 'Sleep Regularity Index per day: 100 means the same minutes asleep as the next day, 0 means no better than chance.',
    source: 'daily',
    layout: 'overlay',
    keys: [K.sri],
    domain: [0, 100],
    ticks: [0, 25, 50, 75, 100],
    minRows: 3,
    reading: (t, reg) => `Median SRI ${med(t, reg, K.sri)} across ${count(t.cols[K.sri])} days.`,
    method: {
      body: (
        <>
          <p>SRI follows Phillips et al. 2017. For each pair of consecutive valid days it is the share of minutes whose sleep or wake state matches 24 hours later, rescaled so 100 is identical and 0 is chance.</p>
          <p>A day is valid when the watch was worn for more than 60% of it. Pairs with an invalid day are skipped.</p>
        </>
      ),
      cite: 'Phillips AJK et al. Irregular sleep/wake patterns are associated with poorer academic performance. Sci Rep 2017.',
    },
  },
} as const satisfies Record<string, BandFigureSpec>

const axisFormat = (d: MetricDef) => (v: number) => {
  if (d.clock) return clock(v)
  if (d.unit === 'h') return `${v}h`
  if (d.unit === 'min') return `${v}m`
  if (d.unit === '%') return `${v}%`
  return String(v)
}

/** Clock axes get whole-hour bounds and 2 h ticks; d3's 1-2-5 ticks would land on 01:00 and 06:00. */
function clockAxis(series: readonly BandSeriesSpec[]): { domain: [number, number]; ticks: number[] } {
  const lo: number[] = []
  const hi: number[] = []
  for (const s of series) {
    const v = s.values.filter(isNum).sort((a, b) => a - b)
    if (!v.length) continue
    lo.push(v[Math.floor(v.length * 0.02)])
    hi.push(v[Math.floor(v.length * 0.98)])
  }
  const a = Math.floor(Math.min(...lo, 23))
  const b = Math.ceil(Math.max(...hi, 32))
  const step = b - a > 10 ? 3 : 2
  const ticks: number[] = []
  for (let h = Math.ceil(a / step) * step; h <= b; h += step) ticks.push(h)
  return { domain: [a, b], ticks }
}

/** Bounds from the 2-98% spread, never below zero, and never past 100 for a percentage. */
function valueAxis(series: readonly BandSeriesSpec[], d: MetricDef): { domain: [number, number]; ticks?: number[] } {
  const v = series.flatMap((s) => s.values.filter(isNum)).sort((a, b) => a - b)
  if (!v.length) return { domain: [0, 1] }
  const lo = v[Math.floor(v.length * 0.02)]
  const hi = v[Math.floor(v.length * 0.98)]
  const pad = (hi - lo || 1) * 0.08
  const [a, b] = scaleLinear()
    .domain([Math.max(0, lo - pad), d.unit === '%' ? Math.min(100, hi + pad) : hi + pad])
    .nice(4)
    .domain()
  return { domain: [Math.max(0, a), d.unit === '%' ? Math.min(100, b) : b] }
}

export function BandFigure({ spec }: { spec: BandFigureSpec }) {
  const { range } = useObservatory()
  return spec.source === 'nights' ? <NightsBand spec={spec} range={range} /> : <DailyBand spec={spec} range={range} />
}

function NightsBand({ spec, range }: { spec: BandFigureSpec; range: Range }) {
  const q = useNights(range)
  const table = useMemo(() => (q.data ? alignDays(range, q.data.nights, q.data.columns, spec.keys) : undefined), [q.data, range, spec.keys])
  return <BandBody spec={spec} state={withTable(loadable(q), table)} />
}

function DailyBand({ spec, range }: { spec: BandFigureSpec; range: Range }) {
  const q = useDaily(range, spec.keys)
  const table = useMemo(() => (q.data ? alignDays(range, q.data.days, q.data.columns, spec.keys) : undefined), [q.data, range, spec.keys])
  return <BandBody spec={spec} state={withTable(loadable(q), table)} />
}

function withTable(s: Loadable<unknown>, table: DayTable | undefined): Loadable<DayTable> {
  return s.kind === 'ready' && table ? { ...s, data: table } : s.kind === 'ready' ? { kind: 'loading' } : s
}

function BandBody({ spec, state }: { spec: BandFigureSpec; state: Loadable<DayTable> }) {
  const { registry } = useObservatory()
  return (
    <Frame state={state} height={spec.layout === 'overlay' ? 240 : 200}>
      {(t, fetching) => {
        const sparse = spec.keys.every((k) => count(t.cols[k]) < spec.minRows)
        return (
          <Figure
            index={spec.index}
            title={spec.title}
            caption={spec.caption}
            reading={sparse ? undefined : spec.reading(t, registry)}
            legend={
              spec.layout === 'overlay' && spec.keys.length > 1 ? (
                <Legend items={spec.keys.map((k) => ({ label: def(registry, k).label, color: colorOf(spec, k), kind: 'band' as const }))} />
              ) : undefined
            }
            method={spec.method}
            fetching={fetching}
          >
            {sparse ? (
              <EmptyState title="Too few nights">Fewer than {spec.minRows} nights with this measure fall inside the range.</EmptyState>
            ) : spec.layout === 'overlay' ? (
              <BandPanel spec={spec} keys={spec.keys} table={t} registry={registry} height={260} />
            ) : (
              <div className="space-y-6">
                {spec.keys.map((k) => (
                  <div key={k} className="min-w-0">
                    <PanelLabel title={def(registry, k).label} value={`median ${med(t, registry, k)}`} />
                    <BandPanel spec={spec} keys={[k]} table={t} registry={registry} height={150} />
                  </div>
                ))}
              </div>
            )}
          </Figure>
        )
      }}
    </Frame>
  )
}

const colorOf = (spec: BandFigureSpec, k: string) => spec.colors?.[k] ?? METRIC_COLOR[k] ?? SIGNAL.ink2

function BandPanel({ spec, keys, table, registry, height }: { spec: BandFigureSpec; keys: readonly string[]; table: DayTable; registry: Registry; height: number }) {
  const d = def(registry, keys[0])
  const series = useMemo<BandSeriesSpec[]>(
    () =>
      keys.map((k) => ({
        key: k,
        label: def(registry, k).label,
        color: colorOf(spec, k),
        values: d.clock ? table.cols[k].map(eveningClock) : table.cols[k],
      })),
    [keys, registry, spec, table, d.clock],
  )
  const axis = d.clock ? clockAxis(series) : spec.domain ? { domain: spec.domain, ticks: spec.ticks } : valueAxis(series, d)
  return (
    <BandChart
      days={table.days as IsoDate[]}
      series={series}
      height={height}
      domain={axis.domain}
      ticks={axis.ticks ?? 4}
      format={axisFormat(d)}
      valueFormat={fmtValue(d)}
      label={`${keys.map((k) => def(registry, k).label).join(', ')} by night`}
    />
  )
}

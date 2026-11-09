import type { ReactNode } from 'react'
import { SIGNAL } from '@/core/color'
import type { Column, Daily } from '@/core/domain'
import { formatMetric } from '@/core/format'
import { def, K, METRIC_COLOR, type Registry } from '@/core/metrics'
import { isNum, median, quantile } from '@/core/stats'
import { BandChart, type BandSeriesSpec, type RefBand } from '@/ui/charts/BandChart'
import { Figure, FigureSkeleton, Legend, type MethodNote } from '@/ui/charts/Figure'
import { EmptyState } from '@/ui/primitives'

export const DAILY_KEYS = [K.rhr, K.nightHr, K.nightHrMin, K.dayHr, K.dip, K.hrv, K.spo2, K.spo2P5, K.resp] as const

const FLOOR_COLOR = SIGNAL.deep

interface PanelSpec {
  title?: string
  series: { key: string; color: string }[]
  height: number
  refBands?: RefBand[]
}

type Col = (key: string) => Column
type Fmt = (key: string, v: number | null) => string

interface BandFigureSpec {
  index: string
  title: string
  caption: string
  panels: PanelSpec[]
  method: MethodNote
  reading: (col: Col, fmt: Fmt) => ReactNode
}

const share = (vs: Column, pred: (v: number) => boolean) => {
  const n = vs.filter(isNum)
  return n.length ? Math.round((n.filter(pred).length / n.length) * 100) : null
}

const ROLLING: MethodNote = {
  body: 'Dots are single nights. The line is a centered 14-night rolling median and the ribbon its interquartile range, shown once at least four nights fall in the window.',
}

export const BAND_FIGURES: readonly BandFigureSpec[] = [
  {
    index: '4.1',
    title: 'Resting and sleeping heart rate',
    caption: 'Three heart-rate measures on one bpm axis: the morning resting value, the mean while asleep, and the floor (5th percentile) while asleep.',
    panels: [
      {
        series: [
          { key: K.rhr, color: METRIC_COLOR[K.rhr] },
          { key: K.nightHr, color: METRIC_COLOR[K.nightHr] },
          { key: K.nightHrMin, color: FLOOR_COLOR },
        ],
        height: 260,
      },
    ],
    method: {
      body: `${ROLLING.body} Resting HR is the value the watch reports the morning after night D. Sleeping HR is the mean inside the main sleep episode, its floor the 5th percentile.`,
    },
    reading: (col, fmt) => {
      const rhr = median(col(K.rhr))
      const night = median(col(K.nightHr))
      const floor = median(col(K.nightHrMin))
      if (night == null) return null
      return (
        <>
          Median sleeping HR is <b className="num">{fmt(K.nightHr, night)} bpm</b>
          {rhr != null && <>, {fmt(K.nightHr, Math.abs(rhr - night))} bpm {rhr > night ? 'below' : 'above'} resting HR ({fmt(K.rhr, rhr)})</>}
          {floor != null && <>, with the floor at {fmt(K.nightHrMin, floor)} bpm</>}.
        </>
      )
    },
  },
  {
    index: '4.2',
    title: 'Heart-rate variability at night',
    caption: 'SDNN of HRV samples taken during sleep. Higher is generally better recovered.',
    panels: [{ series: [{ key: K.hrv, color: METRIC_COLOR[K.hrv] }], height: 220 }],
    method: { body: `${ROLLING.body} HRV is the mean SDNN across the watch's HRV samples inside the sleep episode.` },
    reading: (col, fmt) => {
      const v = col(K.hrv)
      const m = median(v)
      if (m == null) return null
      return (
        <>
          Median night HRV is <b className="num">{fmt(K.hrv, m)} ms</b>, with half of nights between {fmt(K.hrv, quantile(v, 0.25))} and{' '}
          {fmt(K.hrv, quantile(v, 0.75))} ms.
        </>
      )
    },
  },
  {
    index: '4.3',
    title: 'Nocturnal heart-rate dip',
    caption: 'How far sleeping HR falls below daytime HR. The shaded band is the typical dipper range.',
    panels: [{ series: [{ key: K.dip, color: METRIC_COLOR[K.dip] }], height: 220, refBands: [{ from: 10, to: 20, label: 'Typical dipper range, 10–20%' }] }],
    method: {
      body: `${ROLLING.body} Dip is (daytime HR − sleeping HR) / daytime HR, with daytime HR the mean between 10:00 and 20:00. Under 10% is conventionally called non-dipping.`,
    },
    reading: (col, fmt) => {
      const v = col(K.dip)
      const m = median(v)
      if (m == null) return null
      const non = share(v, (x) => x < 10)
      return (
        <>
          Median dip is <b className="num">{fmt(K.dip, m)}%</b> (daytime {fmt(K.dayHr, median(col(K.dayHr)))} bpm against sleeping{' '}
          {fmt(K.nightHr, median(col(K.nightHr)))} bpm). {non}% of nights fall under 10%.
        </>
      )
    },
  },
  {
    index: '4.4',
    title: 'Oxygen and breathing',
    caption: 'Blood-oxygen saturation and its floor share one % axis; respiratory rate sits below on its own.',
    panels: [
      {
        title: 'SpO2, %',
        series: [
          { key: K.spo2, color: METRIC_COLOR[K.spo2] },
          { key: K.spo2P5, color: FLOOR_COLOR },
        ],
        height: 200,
      },
      { title: 'Respiratory rate, breaths/min', series: [{ key: K.resp, color: METRIC_COLOR[K.resp] }], height: 170 },
    ],
    method: { body: `${ROLLING.body} SpO2 is the mean of samples during sleep and the floor their 5th percentile. Respiratory rate is the mean during sleep.` },
    reading: (col, fmt) => {
      const s = median(col(K.spo2))
      const r = median(col(K.resp))
      if (s == null && r == null) return null
      const low = share(col(K.spo2P5), (x) => x < 90)
      return (
        <>
          Median night SpO2 is <b className="num">{fmt(K.spo2, s)}%</b>
          {low != null && <>, and the floor dips under 90% on {low}% of nights</>}. Breathing runs at a median {fmt(K.resp, r)} breaths/min.
        </>
      )
    },
  },
]

/** Domain over the 2–98% of every series plus any reference band, snapped to multiples of `step`. */
function snappedDomain(cols: Column[], refs: RefBand[], step: number): [number, number] | undefined {
  const v = cols.flat().filter(isNum).sort((a, b) => a - b)
  if (!v.length) return undefined
  const lo = Math.min(v[Math.floor(v.length * 0.02)], ...refs.map((r) => Math.min(r.from, r.to)))
  const hi = Math.max(v[Math.floor(v.length * 0.98)], ...refs.map((r) => Math.max(r.from, r.to)))
  const pad = step / 2
  return [Math.floor((lo - pad) / step) * step, Math.ceil((hi + pad) / step) * step]
}

export function BandFigure({ spec, daily, registry, fetching }: { spec: BandFigureSpec; daily: Daily | undefined; registry: Registry; fetching: boolean }) {
  const fmt: Fmt = (key, v) => formatMetric(def(registry, key), v)
  const col: Col = (key) => daily?.columns[key] ?? []
  const keys = spec.panels.flatMap((p) => p.series)
  const legend =
    keys.length > 1 ? <Legend items={keys.map((s) => ({ label: def(registry, s.key).label, color: s.color, kind: 'band' as const }))} /> : undefined

  if (!daily) return <FigureSkeleton height={spec.panels.reduce((h, p) => h + p.height, 0)} />
  const empty = keys.every((s) => !col(s.key).some(isNum))

  return (
    <Figure
      index={spec.index}
      title={spec.title}
      caption={spec.caption}
      reading={empty ? undefined : spec.reading(col, fmt)}
      legend={empty ? undefined : legend}
      method={spec.method}
      fetching={fetching}
    >
      {empty ? (
        <EmptyState title="No nights with these measures">The watch recorded none of them in this range. Try a longer range.</EmptyState>
      ) : (
        <div className="space-y-5">
          {spec.panels.map((p, i) => {
            const last = i === spec.panels.length - 1
            const series: BandSeriesSpec[] = p.series.map((s) => ({ key: s.key, label: def(registry, s.key).label, color: s.color, values: col(s.key) }))
            const refBands = p.refBands ?? []
            const unitDecimals = def(registry, p.series[0].key).decimals
            return (
              <div key={p.title ?? i}>
                {p.title && <div className="eyebrow mb-1.5 !text-ink-3">{p.title}</div>}
                <BandChart
                  days={daily.days}
                  series={series}
                  height={p.height}
                  domain={refBands.length ? snappedDomain(series.map((s) => s.values as Column), refBands, 5) : undefined}
                  refBands={refBands}
                  xAxis={last}
                  margin={{ top: 10, right: 14, bottom: last ? 26 : 6, left: 44 }}
                  valueFormat={(v) => (v == null ? '—' : formatMetric({ unit: '', decimals: unitDecimals, clock: false }, v))}
                  label={`${spec.title}${p.title ? `, ${p.title}` : ''}`}
                />
              </div>
            )
          })}
        </div>
      )}
    </Figure>
  )
}

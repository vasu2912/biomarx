import { useMemo } from 'react'
import type { Daily } from '@/core/domain'
import { compact, formatMetric, unitSuffix } from '@/core/format'
import { def, K, METRIC_COLOR, type Registry } from '@/core/metrics'
import { BandChart, type BandSeriesSpec } from '@/ui/charts/BandChart'
import { SIGNAL } from '@/core/color'
import { quantile } from '@/core/stats'
import { scaleLinear } from 'd3-scale'
import type { LegendItem } from '@/ui/charts/Figure'

export const TREND_SPECS = [
  { key: K.tst, axis: (v: number) => `${v}h` },
  { key: K.rhr, axis: (v: number) => String(v) },
  { key: K.hrv, axis: (v: number) => String(v) },
  { key: K.steps, axis: (v: number) => compact(v), zero: true },
] as const

export const TREND_KEYS: readonly string[] = TREND_SPECS.map((s) => s.key)

export const TREND_LEGEND: LegendItem[] = [
  { label: 'Daily value', color: SIGNAL.ink3, kind: 'dot' },
  { label: '14-day median', color: SIGNAL.ink2, kind: 'line' },
  { label: 'Interquartile band', color: SIGNAL.ink3, kind: 'band' },
]

export function FourTrends({ daily, registry }: { daily: Daily; registry: Registry }) {
  const panels = useMemo(
    () =>
      TREND_SPECS.map((s) => {
        const d = def(registry, s.key)
        const suffix = unitSuffix(d)
        const series: BandSeriesSpec[] = [
          { key: s.key, label: d.label, color: METRIC_COLOR[s.key] ?? SIGNAL.ink2, values: daily.columns[s.key] ?? [], window: 14 },
        ]
        const hi = 'zero' in s ? quantile(series[0].values, 0.98) : null
        return {
          key: s.key,
          domain: hi != null ? (scaleLinear().domain([0, hi * 1.1]).nice(4).domain() as [number, number]) : undefined,
          title: d.label,
          unit: suffix || (d.unit === 'h' ? 'hours' : d.unit),
          series,
          axis: s.axis,
          value: (v: number | null) => `${formatMetric(d, v)}${suffix && v != null ? ` ${suffix}` : ''}`,
        }
      }),
    [daily, registry],
  )

  return (
    <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
      {panels.map((p) => (
        <div key={p.key} className="min-w-0">
          <div className="mb-1 flex items-baseline gap-2 text-[13px]">
            <span className="text-ink">{p.title}</span>
            <span className="text-[11.5px] text-ink-3">{p.unit}</span>
          </div>
          <BandChart
            days={daily.days}
            series={p.series}
            height={180}
            domain={p.domain}
            format={p.axis}
            valueFormat={p.value}
            label={`${p.title}, daily with 14-day median`}
          />
        </div>
      ))}
    </div>
  )
}

import { useMemo, type ReactNode } from 'react'
import { useObservatory } from '@/app/context'
import type { Daily } from '@/core/domain'
import { compact, deltaTone, fixed, formatDelta, formatMetric, unitSuffix } from '@/core/format'
import { def, METRIC_COLOR, type Registry } from '@/core/metrics'
import { isNum, median, quantile, type Series } from '@/core/stats'
import { scaleLinear } from 'd3-scale'
import { useDaily } from '@/infra/queries'
import { Figure, FigureSkeleton, type MethodNote } from '@/ui/charts/Figure'
import { cn, EmptyState } from '@/ui/primitives'
import { Panels, type PanelSpec } from '@/ui/charts/Panels'

export interface MetricFigureSpec {
  index: string
  title: string
  caption: string
  method: MethodNote
  metrics: readonly string[]
  cols: 2 | 4
  empty: string
}

export interface MetricSummary {
  key: string
  label: string
  value: string
  delta: string | null
  tone: 'good' | 'bad' | 'neutral'
  coverage: number
  window: number
}

/** Counts and shares that sit near zero get a zero floor, so the padded auto-domain never shows negative steps. */
function zeroFloored(values: Series): [number, number] | undefined {
  const lo = quantile(values, 0.02)
  const hi = quantile(values, 0.995)
  if (lo == null || hi == null || lo < 0 || lo > (hi - lo) * 0.3) return undefined
  return scaleLinear().domain([0, hi * 1.05 || 1]).nice(4).domain() as [number, number]
}

/** Sparse series get a wider window so the rolling median still has enough samples to stand on. */
const windowFor = (coverage: number) => (coverage >= 0.6 ? 14 : 28)

function summarise(d: Daily, prev: Daily | undefined, reg: Registry, key: string): MetricSummary & { panel: PanelSpec } {
  const m = def(reg, key)
  const values = d.columns[key] ?? []
  const unit = unitSuffix(m)
  const withUnit = (v: number | null) => (v == null ? '—' : `${formatMetric(m, v)}${unit ? ` ${unit}` : ''}`)
  const med = median(values)
  const pm = prev ? median(prev.columns[key] ?? []) : null
  const coverage = values.length ? values.filter(isNum).length / values.length : 0
  const window = windowFor(coverage)
  const delta = med != null && pm != null ? med - pm : null
  const big = m.unit === 'steps' || m.unit === 'kcal'
  return {
    key,
    label: m.label,
    value: withUnit(med),
    delta: delta == null ? null : formatDelta(m, delta),
    tone: delta == null ? 'neutral' : deltaTone(delta, m.direction),
    coverage,
    window,
    panel: {
      key,
      title: m.label,
      unit: unit || undefined,
      domain: zeroFloored(values),
      series: [{ key, label: m.label, color: METRIC_COLOR[key], values, window }],
      format: (v) => (big ? compact(v) : fixed(v, Math.min(1, m.decimals))),
      valueFormat: withUnit,
    },
  }
}

const TONE = { good: 'text-good', bad: 'text-bad', neutral: 'text-ink-3' } as const

function Stat({ s }: { s: MetricSummary }) {
  return (
    <>
      <span className="text-ink-3">median </span>
      {s.value}
      {s.delta && <span className={cn('ml-1.5', TONE[s.tone])}>{s.delta}</span>}
    </>
  )
}

/** A figure of one small multiple per metric, each headed by its median and the change against the previous period. */
export function MetricPanelsFigure({ spec, reading }: { spec: MetricFigureSpec; reading: (s: MetricSummary[], hasPrev: boolean) => ReactNode }) {
  const { range, prev, registry } = useObservatory()
  const q = useDaily(range, spec.metrics)
  const qp = useDaily(prev, spec.metrics)
  const model = useMemo(() => {
    if (!q.data) return null
    const rows = spec.metrics.map((k) => summarise(q.data, qp.data, registry, k))
    return rows.some((r) => r.coverage > 0) ? rows : null
  }, [q.data, qp.data, registry, spec.metrics])

  if (q.isPending) return <FigureSkeleton height={200} />
  const head = { index: spec.index, title: spec.title, caption: spec.caption, method: spec.method }
  if (q.isError || !model) {
    return (
      <Figure {...head}>
        <EmptyState title="Nothing measured in this range">{q.error?.message ?? spec.empty}</EmptyState>
      </Figure>
    )
  }
  const panels = model.map((r) => ({ ...r.panel, stat: <Stat s={r} /> }))
  return (
    <Figure {...head} fetching={(q.isPlaceholderData && q.isFetching) || (qp.isPlaceholderData && qp.isFetching)} reading={reading(model, prev != null && qp.data != null)}>
      <Panels days={q.data.days} panels={panels} cols={spec.cols} />
    </Figure>
  )
}

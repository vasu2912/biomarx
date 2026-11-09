import { useMemo } from 'react'
import { useObservatory } from '@/app/context'
import { SIGNAL } from '@/core/color'
import type { Daily } from '@/core/domain'
import { clockDiff, fixed, formatMetric } from '@/core/format'
import { def, K, METRIC_COLOR, type Registry } from '@/core/metrics'
import { clockMedian, isNum, median, unwrapEvening, type Series } from '@/core/stats'
import { clock } from '@/core/time'
import { useDaily } from '@/infra/queries'
import { Figure, FigureSkeleton, Legend } from '@/ui/charts/Figure'
import { EmptyState } from '@/ui/primitives'
import { Panels, type PanelSpec } from '@/ui/charts/Panels'

const METRICS = [K.mesor, K.amp, K.acro, K.r2, K.isSteps, K.ivSteps, K.raSteps, K.isHr, K.ivHr, K.raHr, K.m10On, K.l5On] as const
const R2_MIN = 0.15

const col = (d: Daily, key: string): Series => d.columns[key] ?? []
const hasAny = (s: Series) => s.some(isNum)

function useRhythmDaily() {
  const { range } = useObservatory()
  return useDaily(range, METRICS)
}

interface CosinorModel {
  panels: PanelSpec[]
  fitted: number
  hidden: number
  mesor: number | null
  amp: number | null
  acro: number | null
}

function cosinorModel(d: Daily, reg: Registry): CosinorModel {
  const r2 = col(d, K.r2)
  const keep = (i: number) => isNum(r2[i]) && r2[i] >= R2_MIN
  const mask = (s: Series) => s.map((v, i) => (keep(i) && isNum(v) ? v : null))
  const mesor = mask(col(d, K.mesor))
  const amp = mask(col(d, K.amp))
  const acroRaw = mask(col(d, K.acro))
  const center = clockMedian(acroRaw)
  const acro = center == null ? acroRaw : acroRaw.map((v) => (v == null ? null : center + clockDiff(v, center)))
  const panel = (key: string, values: (number | null)[], format: (v: number) => string, unit?: string): PanelSpec => {
    const m = def(reg, key)
    const med = key === K.acro ? center : median(values)
    return {
      key,
      title: m.label,
      unit,
      stat: `median ${formatMetric(m, med)}${unit && !m.clock ? ` ${unit}` : ''}`,
      series: [{ key, label: m.label, color: METRIC_COLOR[key], values }],
      format,
      valueFormat: (v) => formatMetric(m, v) + (unit && !m.clock && v != null ? ` ${unit}` : ''),
    }
  }
  return {
    panels: [
      panel(K.mesor, mesor, (v) => fixed(v, 0), 'bpm'),
      panel(K.amp, amp, (v) => fixed(v, 0), 'bpm'),
      panel(K.acro, acro, clock),
    ],
    fitted: r2.filter(isNum).length,
    hidden: r2.filter((v) => isNum(v) && v < R2_MIN).length,
    mesor: median(mesor),
    amp: median(amp),
    acro: center,
  }
}

export function CosinorFigure() {
  const { registry } = useObservatory()
  const q = useRhythmDaily()
  const m = useMemo(() => (q.data ? cosinorModel(q.data, registry) : null), [q.data, registry])
  if (q.isPending) return <FigureSkeleton height={220} />
  const head = {
    index: '3.3',
    title: 'Cosinor fit of the daily heart-rate rhythm',
    caption: 'Each dot is one day’s 24 h cosine fit; the line is the 14-day rolling median and the ribbon its interquartile range.',
    method: {
      body: (
        <>
          <p>A 24 h cosine is least-squares fitted to a 3-day window of 5-minute heart rate centred on each day. MESOR is the rhythm-adjusted mean, amplitude half the peak-to-trough swing, acrophase the clock time of the fitted peak.</p>
          <p>Days whose fit explains less than 15% of the variance (R² &lt; 0.15) are hidden from all three panels. Acrophase is unwrapped around its circular median so a peak near midnight does not jump across the axis.</p>
        </>
      ),
      cite: 'Cornelissen G. Cosinor-based rhythmometry. Theor Biol Med Model 2014.',
    },
  }
  if (q.isError || !m || !m.panels.some((p) => hasAny(p.series[0].values))) {
    return (
      <Figure {...head}>
        <EmptyState title="No cosinor fits in this range">{q.error?.message ?? 'A fit needs three days of worn heart rate with a clear 24 h rhythm.'}</EmptyState>
      </Figure>
    )
  }
  return (
    <Figure
      {...head}
      fetching={q.isPlaceholderData && q.isFetching}
      reading={
        <>
          Heart rate swings {fixed(m.amp, 1)} bpm either side of a {fixed(m.mesor, 1)} bpm MESOR and peaks around {clock(m.acro)}. {m.hidden} of {m.fitted} fitted days are hidden for
          R² below {R2_MIN}.
        </>
      }
    >
      <Panels days={q.data.days} panels={m.panels} cols={3} />
    </Figure>
  )
}

const PAIR = [
  { suffix: 'steps', label: 'Steps', color: SIGNAL.sun },
  { suffix: 'hr', label: 'Heart rate', color: SIGNAL.ember },
] as const

const INDICES = [
  { key: 'is', title: 'Interdaily stability', hint: 'higher is steadier day to day' },
  { key: 'iv', title: 'Intradaily variability', hint: 'higher is more fragmented' },
  { key: 'ra', title: 'Relative amplitude', hint: 'higher is a bolder day/night contrast' },
] as const

const TIMING = [
  { key: K.m10On, label: 'M10 onset', color: SIGNAL.sun },
  { key: K.l5On, label: 'L5 onset', color: SIGNAL.deep },
] as const

/** Clock values pivot at 06:00, so L5 just after midnight sits after M10 on one continuous axis. */
const TIMING_PIVOT = 6

interface NpcraModel {
  panels: PanelSpec[]
  medians: Record<string, number | null>
  m10: number | null
  l5: number | null
}

function npcraModel(d: Daily, reg: Registry): NpcraModel {
  const medians: Record<string, number | null> = {}
  const panels: PanelSpec[] = INDICES.map((ix) => ({
    key: ix.key,
    title: ix.title,
    unit: ix.hint,
    stat: PAIR.map((p) => {
      const v = median(col(d, `${ix.key}_${p.suffix}`))
      medians[`${ix.key}_${p.suffix}`] = v
      return `${p.label === 'Steps' ? 'steps' : 'HR'} ${fixed(v, 2)}`
    }).join(' · '),
    series: PAIR.map((p) => ({ key: `${ix.key}_${p.suffix}`, label: p.label, color: p.color, values: col(d, `${ix.key}_${p.suffix}`) })),
    format: (v) => fixed(v, 2),
  }))
  const m10 = clockMedian(col(d, K.m10On))
  const l5 = clockMedian(col(d, K.l5On))
  panels.push({
    key: 'timing',
    title: 'Activity timing',
    unit: 'clock',
    stat: `M10 ${clock(m10)} · L5 ${clock(l5)}`,
    legend: TIMING.map((t) => ({ label: t.label, color: t.color, kind: 'dot' })),
    series: TIMING.map((t) => ({ key: t.key, label: def(reg, t.key).label, color: t.color, dotsOnly: true, values: col(d, t.key).map((v) => unwrapEvening(v, TIMING_PIVOT)) })),
    format: clock,
    valueFormat: (v) => clock(v),
    domain: [TIMING_PIVOT, TIMING_PIVOT + 24],
    ticks: [6, 12, 18, 24, 30],
  })
  return { panels, medians, m10, l5 }
}

function cmp(verb: string, hr: number | null, steps: number | null, name: string): string {
  if (hr == null || steps == null) return ''
  const [a, b, va, vb] = hr >= steps ? ['The heart-rate rhythm', 'the step rhythm', hr, steps] as const : ['The step rhythm', 'the heart-rate rhythm', steps, hr] as const
  return `${a} ${verb} than ${b} (${name} ${fixed(va, 2)} vs ${fixed(vb, 2)}).`
}

export function NpcraFigure() {
  const { registry } = useObservatory()
  const q = useRhythmDaily()
  const m = useMemo(() => (q.data ? npcraModel(q.data, registry) : null), [q.data, registry])
  if (q.isPending) return <FigureSkeleton height={420} />
  const head = {
    index: '3.4',
    title: 'Non-parametric rhythm: stability, fragmentation, contrast',
    caption: 'Each index is computed for steps and for heart rate on the same unitless scale; the bottom-right panel shows when the most and least active hours begin.',
    method: {
      body: (
        <>
          <p>Non-parametric circadian rhythm analysis on a 14-day sliding window of hourly steps and hourly heart rate. IS (0 to 1) compares the mean 24 h profile to the overall variance. IV (0 to 2) is the mean squared hour-to-hour change over the variance. RA is (M10 − L5) / (M10 + L5).</p>
          <p>M10 and L5 onsets are the start hours of the most active 10 and least active 5 consecutive hours of the step profile. The clock axis runs from 06:00 to 06:00 the next day.</p>
        </>
      ),
      cite: 'Van Someren EJW et al. Chronobiol Int 1999;16:505–518.',
    },
  }
  if (q.isError || !m || !m.panels.some((p) => p.series.some((s) => hasAny(s.values)))) {
    return (
      <Figure {...head}>
        <EmptyState title="No rhythm indices in this range">{q.error?.message ?? 'Each index needs 14 days of hourly steps and heart rate.'}</EmptyState>
      </Figure>
    )
  }
  const md = m.medians
  return (
    <Figure
      {...head}
      fetching={q.isPlaceholderData && q.isFetching}
      legend={<Legend items={PAIR.map((p) => ({ label: p.label, color: p.color, kind: 'band' }))} />}
      reading={
        <>
          {cmp('is steadier from day to day', md.is_hr, md.is_steps, 'IS')} {cmp('is more fragmented within the day', md.iv_hr, md.iv_steps, 'IV')} The most active 10 hours
          start around {clock(m.m10)}; the least active 5 around {clock(m.l5)}.
        </>
      }
    >
      <Panels days={q.data.days} panels={m.panels} cols={2} height={180} />
    </Figure>
  )
}

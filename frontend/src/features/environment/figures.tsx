import { useMemo, type ReactNode } from 'react'
import { useObservatory } from '@/app/context'
import { SIGNAL } from '@/core/color'
import type { Environment, Season } from '@/core/domain'
import { fixed, formatMetric } from '@/core/format'
import { def, K, METRIC_COLOR, type Registry } from '@/core/metrics'
import { isNum, median } from '@/core/stats'
import { clock, duration, formatRange } from '@/core/time'
import { WeekBars, type WeekStack } from '@/features/fitness/WeekBars'
import { Figure, FigureSkeleton, type MethodNote } from '@/ui/charts/Figure'
import { EmptyState } from '@/ui/primitives'
import { monthOfWeek, SeasonPanels, type SeasonPanel } from './Seasons'

interface FigureProps {
  data: Environment | undefined
  fetching: boolean
  error?: string
}

/** Naming a seasonal low and high needs most of the year covered; with sparse weeks the extremes are noise. */
const MIN_WEEKS_FOR_EXTREMES = 26

/** Weeks with the curve's lowest and highest value, or null when too few weeks have a value. */
function extremes(s: Season): { lo: number; hi: number } | null {
  if (s.median.filter(isNum).length < MIN_WEEKS_FOR_EXTREMES) return null
  let lo = -1
  let hi = -1
  s.median.forEach((v, k) => {
    if (!isNum(v)) return
    if (lo < 0 || v < s.median[lo]!) lo = k
    if (hi < 0 || v > s.median[hi]!) hi = k
  })
  return lo < 0 ? null : { lo, hi }
}

function LowHigh({ s, fmt }: { s: Season; fmt: (v: number | null) => string }) {
  const e = extremes(s)
  if (!e) return null
  return (
    <>
      <span className="text-ink-3">low </span>
      {monthOfWeek(e.lo)} {fmt(s.median[e.lo])}
      <span className="ml-2 text-ink-3">high </span>
      {monthOfWeek(e.hi)} {fmt(s.median[e.hi])}
    </>
  )
}

function seasonPanels(reg: Registry, by: Record<string, Season>): SeasonPanel[] {
  const vf = (key: string) => (v: number | null) => (v == null ? '—' : `${formatMetric(def(reg, key), v)}${key === K.rhr ? ' bpm' : ''}`)
  const series = (key: string, color = METRIC_COLOR[key]) => ({ key, label: def(reg, key).label, color, season: by[key] })
  const panels: SeasonPanel[] = [
    { key: K.daylight, title: def(reg, K.daylight).label, unit: 'min', series: [series(K.daylight)], format: (v) => fixed(v, 0), valueFormat: vf(K.daylight) },
    {
      key: 'timing',
      title: 'Sleep onset and mid-sleep',
      legend: [K.onset, K.mid].map((k) => ({ label: def(reg, k).label, color: METRIC_COLOR[k], kind: 'line' })),
      series: [series(K.onset), series(K.mid)],
      format: clock,
      valueFormat: vf(K.onset),
    },
    { key: K.tst, title: def(reg, K.tst).label, unit: 'h', series: [series(K.tst)], format: (v) => fixed(v, 1), valueFormat: vf(K.tst) },
    { key: K.rhr, title: def(reg, K.rhr).label, unit: 'bpm', series: [series(K.rhr)], format: (v) => fixed(v, 0), valueFormat: vf(K.rhr) },
  ]
  return panels.map((p) => ({ ...p, stat: <LowHigh s={p.series[0].season} fmt={p.valueFormat} /> }))
}

// ---------------------------------------------------------------- 9.2

export function SeasonsFigure({ data, fetching, error }: FigureProps) {
  const { registry } = useObservatory()
  const span = data ? formatRange(data.season_span.start, data.season_span.end) : ''
  const head = {
    index: '9.2',
    title: 'The year, week by week',
    caption: `Each line is the typical value for that week of the year: the median across years of each year’s weekly median. The ribbon spans the middle half of the years where at least two cover the week. This figure reads the whole dataset, ${span || 'every year of it'}, not only the selected range.`,
    method: {
      body: (
        <>
          <p>
            For each ISO week (Monday to Sunday) of each year, the median of that week’s daily values over the days that have one. Then, for each week number
            1 to 53, the median across years of those weekly medians, and their 25th and 75th percentiles when two or more years contribute. Month labels mark where each month begins.
          </p>
          <p>
            Sleep onset and mid-sleep sit on a noon-to-noon clock so the hours around midnight stay together. Resting HR is the watch’s value for the day after night D, as in Heart.
          </p>
          <p>These are descriptive statistics only. A seasonal pattern can come from weather, daylight, travel, work or a change of device, and nothing here tells them apart.</p>
        </>
      ),
    } satisfies MethodNote,
  }
  const model = useMemo(() => {
    if (!data) return null
    const by = Object.fromEntries(data.seasons.map((s) => [s.key, s]))
    return { by, panels: seasonPanels(registry, by), any: data.seasons.some((s) => s.median.some(isNum)) }
  }, [data, registry])
  if (!model) {
    if (error) return <Figure {...head}><EmptyState title="Seasons unavailable">{error}</EmptyState></Figure>
    return <FigureSkeleton height={420} />
  }
  if (!model.any) {
    return (
      <Figure {...head}>
        <EmptyState title="Nothing measured yet">None of these metrics has a value on any day of the dataset.</EmptyState>
      </Figure>
    )
  }
  const parts = (
    [
      [K.daylight, 'time in daylight is highest', 'lowest'],
      [K.onset, 'sleep onset is latest', 'earliest'],
      [K.rhr, 'resting HR is highest', 'lowest'],
    ] as const
  ).flatMap(([k, high, low]) => {
    const e = extremes(model.by[k])
    return e ? [`${high} around ${monthOfWeek(e.hi)} and ${low} around ${monthOfWeek(e.lo)}`] : []
  })
  return (
    <Figure
      {...head}
      fetching={fetching}
      reading={
        <>
          {parts.length > 0 && `In the typical year, ${parts.join('; ')}.`}
        </>
      }
    >
      <SeasonPanels panels={model.panels} />
    </Figure>
  )
}

// ---------------------------------------------------------------- 9.3

const HEADPHONE = SIGNAL.spo2
const ENVIRONMENTAL = SIGNAL.cool
const pct = (v: number) => `${fixed(v, v > 0 && v < 10 ? 1 : 0)}%`
const ALLOWANCE = [{ y: 100, label: 'WHO weekly allowance' }]

function PanelHead({ title, unit, stat }: { title: string; unit: string; stat?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-hairline pb-1.5">
      <div className="text-[12.5px] text-ink-2">
        {title}
        <span className="ml-1.5 text-ink-3">{unit}</span>
      </div>
      {stat && <div className="num text-[12px] text-ink">{stat}</div>}
    </div>
  )
}

export function SoundFigure({ data, fetching, error }: FigureProps) {
  const head = {
    index: '9.3',
    title: 'Sound dose',
    caption: 'Each week’s sound exposure as a share of the WHO weekly allowance for safe listening: headphone audio first, and below it, for context, the sound around you as the watch heard it.',
    method: {
      body: (
        <>
          <p>
            Each sample reports a sound level in dBA from its start to its end, taken as the equivalent continuous level over that time. Dose = Σ hours × 10^((L − 80)/10) / 40 × 100: 40 h
            at 80 dBA is the whole weekly allowance of 1.6 Pa²h, and every 3 dB more halves the hours. Samples count in the week they start.
          </p>
          <p>
            Headphone levels are the iPhone’s and watch’s estimates from the volume and the known output of the headphones in use, so they are most accurate with Apple and Beats headphones
            and only approximate with others. Environmental sound is measured by the watch microphone while it is worn. The allowance is a listening standard, so for environmental
            sound the percentage is context, not a limit.
          </p>
        </>
      ),
      cite: 'ITU-T H.870 (03/2022). Guidelines for safe listening devices/systems. World Health Organization, International Telecommunication Union. Safe listening devices and systems: a WHO-ITU standard. Geneva: WHO; 2019.',
    } satisfies MethodNote,
  }
  const model = useMemo(() => {
    if (!data) return null
    const hp = data.headphone.filter((_, k) => data.headphone_samples[k] > 0).filter(isNum)
    const env = data.environmental.filter(isNum)
    return { hp, env, over: hp.filter((v) => v > 100).length, envOver: env.filter((v) => v > 100).length }
  }, [data])
  if (!data || !model) {
    if (error) return <Figure {...head}><EmptyState title="Sound dose unavailable">{error}</EmptyState></Figure>
    return <FigureSkeleton height={380} />
  }
  if (!model.hp.length && !model.env.length) {
    return (
      <Figure {...head}>
        <EmptyState title="No sound levels in this range">The iPhone logs headphone audio levels while you listen, and the watch logs the sound around it while worn.</EmptyState>
      </Figure>
    )
  }
  const hours = (v: number) => duration((v / 100) * data.allowance_hours * 60)
  const hover = (values: readonly (number | null)[], samples: readonly number[], label: string, color: string) => (k: number) =>
    values[k] == null
      ? { rows: [{ label: 'not measured', value: '—' }] }
      : {
          rows: [{ label, value: pct(values[k]!), color, kind: 'swatch' as const }],
          footer: samples[k] ? `As much sound energy as ${hours(values[k]!)} at ${fixed(data.reference_db, 0)} dBA, from ${samples[k]} samples` : 'Nothing logged this week',
        }
  const hpStacks: WeekStack[] = [{ key: 'headphone', label: 'Headphones', color: HEADPHONE, values: data.headphone }]
  const envStacks: WeekStack[] = [{ key: 'environmental', label: 'Environmental', color: ENVIRONMENTAL, values: data.environmental }]
  const medHp = median(model.hp)
  return (
    <Figure
      {...head}
      fetching={fetching}
      reading={
        model.hp.length ? (
          <>
            A median week with headphone audio reaches <span className="num">{pct(medHp ?? 0)}</span> of the weekly allowance; {model.over} of {model.hp.length} such weeks went above 100%.
          </>
        ) : (
          'No headphone audio in this range; the environmental dose below is context only.'
        )
      }
    >
      <div className="space-y-8">
        {model.hp.length > 0 && (
          <section>
            <PanelHead title="Headphones" unit="% of the weekly allowance" stat={<><span className="text-ink-3">median </span>{pct(medHp ?? 0)}</>} />
            <WeekBars
              weeks={data.weeks}
              weekDays={data.week_days}
              stacks={hpStacks}
              refLines={ALLOWANCE}
              height={220}
              format={pct}
              label="Headphone sound dose per week"
              hover={hover(data.headphone, data.headphone_samples, 'of the allowance', HEADPHONE)}
            />
          </section>
        )}
        {model.env.length > 0 && (
          <section>
            <PanelHead
              title="Environmental sound, for context"
              unit="% of the same allowance"
              stat={
                <>
                  <span className="text-ink-3">median </span>
                  {pct(median(model.env) ?? 0)}
                  {model.envOver > 0 && <span className="ml-2 text-ink-3">{model.envOver} weeks above 100%</span>}
                </>
              }
            />
            <WeekBars
              weeks={data.weeks}
              weekDays={data.week_days}
              stacks={envStacks}
              refLines={ALLOWANCE}
              height={180}
              format={pct}
              label="Environmental sound dose per week"
              hover={hover(data.environmental, data.environmental_samples, 'of the allowance, environmental', ENVIRONMENTAL)}
            />
          </section>
        )}
      </div>
    </Figure>
  )
}

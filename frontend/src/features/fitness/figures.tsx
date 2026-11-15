import { useMemo } from 'react'
import { useObservatory } from '@/app/context'
import { SIGNAL } from '@/core/color'
import type { Fitness, Profile, Workout } from '@/core/domain'
import { compact, fixed } from '@/core/format'
import { K, METRIC_COLOR } from '@/core/metrics'
import { isNum, median } from '@/core/stats'
import { duration, formatDate, weekday, WEEKDAYS } from '@/core/time'
import { useDaily } from '@/infra/queries'
import { BandChart } from '@/ui/charts/BandChart'
import { Figure, FigureSkeleton, Legend, type MethodNote } from '@/ui/charts/Figure'
import { EmptyState } from '@/ui/primitives'
import { ProfileForm } from './Profile'
import { WeekBars, type WeekStack } from './WeekBars'

const MODERATE = SIGNAL.sun
const VIGOROUS = SIGNAL.ember
const LOAD = SIGNAL.rem
const STRENGTH = SIGNAL.hrv

const WHO = 'Bull FC et al. WHO 2020 guidelines on physical activity and sedentary behaviour. Br J Sports Med 2020;54:1451–1462.'
const KARVONEN = 'Karvonen MJ et al. Ann Med Exp Biol Fenn 1957;35:307–315.'
const TANAKA = 'Tanaka H, Monahan KD, Seals DR. Age-predicted maximal heart rate revisited. J Am Coll Cardiol 2001;37:153–156.'

interface FigureProps {
  data: Fitness | undefined
  fetching: boolean
}

interface ProfileProps extends FigureProps {
  profile: Profile | undefined
}

const minutes = (v: number) => fixed(v, 0)
const share = (n: number, of: number) => `${fixed((n / of) * 100, 0)}%`

/** “TraditionalStrengthTraining” to “Traditional strength training”. */
export function activityLabel(a: string): string {
  const s = a.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function WorkoutList({ items, trimp }: { items: readonly Workout[]; trimp: boolean }) {
  if (!items.length) return <>No workouts this week.</>
  const shown = items.slice(0, 6)
  return (
    <div className="space-y-0.5">
      {shown.map((w) => (
        <div key={w.start} className="flex items-baseline gap-2">
          <span className="num w-7 shrink-0">{WEEKDAYS[weekday(w.start.slice(0, 10))]}</span>
          <span className="truncate text-ink-2">{activityLabel(w.activity)}</span>
          <span className="num ml-auto pl-2">{duration(w.duration_min)}</span>
          {trimp && <span className="num w-9 text-right text-ink-2">{w.trimp == null ? '—' : fixed(w.trimp, 0)}</span>}
        </div>
      ))}
      {items.length > shown.length && <div>and {items.length - shown.length} more</div>}
    </div>
  )
}

// ---------------------------------------------------------------- 8.1

export function AerobicFigure({ data, fetching }: FigureProps) {
  const head = {
    index: '8.1',
    title: 'Weekly aerobic activity',
    caption: 'Minutes per week at moderate and vigorous effort, with each vigorous minute counted twice, against the WHO range of 150 to 300 moderate-equivalent minutes.',
    method: {
      body: (
        <>
          <p>The watch logs physical effort in kcal/hr·kg, which is numerically the same as METs. Each sample’s minutes, from its start to its end, count as moderate at 3.0–5.9 METs and vigorous at 6.0 or more, in the week (Monday to Sunday) where the sample begins.</p>
          <p>One vigorous minute equals two moderate ones toward the guideline. The watch logs effort whenever it is worn, so a week without a single sample is shaded as missing, not counted as zero.</p>
        </>
      ),
      cite: `${WHO} Ainsworth BE et al. 2011 Compendium of Physical Activities. Med Sci Sports Exerc 2011;43:1575–1581.`,
    } satisfies MethodNote,
  }
  const model = useMemo(() => {
    if (!data) return null
    const eq = data.moderate.map((m, k) => (m == null ? null : m + 2 * (data.vigorous[k] ?? 0)))
    const measured = eq.filter(isNum)
    return { eq, measured, met: measured.filter((v) => v >= 150).length }
  }, [data])
  if (!data || !model) return <FigureSkeleton height={240} />
  if (!model.measured.length) {
    return (
      <Figure {...head}>
        <EmptyState title="No effort samples in this range">The watch logs physical effort while worn; none was recorded for these weeks.</EmptyState>
      </Figure>
    )
  }
  const stacks: WeekStack[] = [
    { key: 'moderate', label: 'Moderate', color: MODERATE, values: data.moderate },
    { key: 'vigorous', label: 'Vigorous, counted twice', color: VIGOROUS, values: data.vigorous.map((v, k) => (data.moderate[k] == null ? null : 2 * (v ?? 0))) },
  ]
  return (
    <Figure
      {...head}
      fetching={fetching}
      reading={
        <>
          A median week holds <span className="num">{minutes(median(model.measured) ?? 0)}</span> moderate-equivalent minutes; {model.met} of {model.measured.length} measured weeks (
          {share(model.met, model.measured.length)}) reached 150.
        </>
      }
      legend={<Legend items={stacks.map((s) => ({ label: s.label, color: s.color }))} />}
    >
      <WeekBars
        weeks={data.weeks}
        weekDays={data.week_days}
        stacks={stacks}
        refLines={[
          { y: 150, label: '150 min' },
          { y: 300, label: '300 min' },
        ]}
        format={minutes}
        label="Moderate-equivalent minutes per week"
        hover={(k) =>
          model.eq[k] == null
            ? { rows: [{ label: 'no effort samples', value: '—' }] }
            : {
                rows: [
                  { label: 'moderate-equivalent', value: `${minutes(model.eq[k]!)} min` },
                  { label: 'moderate', value: `${minutes(data.moderate[k]!)} min`, color: MODERATE, kind: 'swatch' },
                  { label: 'vigorous', value: `${minutes(data.vigorous[k] ?? 0)} min`, color: VIGOROUS, kind: 'swatch' },
                ],
              }
        }
      />
    </Figure>
  )
}

// ---------------------------------------------------------------- 8.2

export function IntensityFigure({ data, fetching, profile }: ProfileProps) {
  const head = {
    index: '8.2',
    title: 'Heart-rate intensity',
    caption: 'Minutes per week with heart rate in the moderate and vigorous bands of your heart-rate reserve.',
    method: {
      body: (
        <>
          <p>
            Each minute with a heart-rate sample is placed on the heart-rate reserve, (HR − HRrest) / (HRmax − HRrest). HRrest is that day’s resting heart rate, or the median of the previous 28 days when the watch
            reported none. HRmax is 208 − 0.7 × age.
          </p>
          <p>Moderate is 40–59% of reserve and vigorous 60–89%; minutes at 90% or more are counted as vigorous too. Outside workouts the watch samples heart rate every few minutes, so these are lower bounds on time spent.</p>
        </>
      ),
      cite: `${KARVONEN} ${TANAKA} Garber CE et al. ACSM position stand. Med Sci Sports Exerc 2011;43:1334–1359.`,
    } satisfies MethodNote,
  }
  if (!data || !profile) return <FigureSkeleton height={240} />
  if (data.hrmax == null) {
    return (
      <Figure {...head}>
        <ProfileForm profile={profile} prompt="Heart-rate bands are a share of your heart-rate reserve, and the maximum is estimated from age. Add your birth date to draw them." />
      </Figure>
    )
  }
  const mod = data.hrr_moderate.filter(isNum)
  const vig = data.hrr_vigorous.filter(isNum)
  const stacks: WeekStack[] = [
    { key: 'moderate', label: 'Moderate, 40–59% HRR', color: MODERATE, values: data.hrr_moderate },
    { key: 'vigorous', label: 'Vigorous, 60% HRR and above', color: VIGOROUS, values: data.hrr_vigorous },
  ]
  if (!mod.length) {
    return (
      <Figure {...head}>
        <EmptyState title="No heart rate in this range">No minute here has both a heart-rate sample and a resting heart rate to measure it against.</EmptyState>
      </Figure>
    )
  }
  return (
    <Figure
      {...head}
      fetching={fetching}
      reading={
        <>
          A median week holds <span className="num">{minutes(median(mod) ?? 0)}</span> minutes at moderate and <span className="num">{minutes(median(vig) ?? 0)}</span> at vigorous heart-rate intensity, with
          HRmax taken as <span className="num">{fixed(data.hrmax, 0)}</span> bpm at age {data.age}.
        </>
      }
      legend={<Legend items={stacks.map((s) => ({ label: s.label, color: s.color }))} />}
    >
      <WeekBars
        weeks={data.weeks}
        weekDays={data.week_days}
        stacks={stacks}
        format={minutes}
        label="Minutes per week by heart-rate intensity"
        hover={(k) =>
          data.hrr_moderate[k] == null
            ? { rows: [{ label: 'no heart rate measured', value: '—' }] }
            : {
                rows: [
                  { label: 'moderate', value: `${minutes(data.hrr_moderate[k]!)} min`, color: MODERATE, kind: 'swatch' },
                  { label: 'vigorous', value: `${minutes(data.hrr_vigorous[k] ?? 0)} min`, color: VIGOROUS, kind: 'swatch' },
                ],
                footer: `of ${compact(data.hr_minutes[k])} minutes with a heart-rate sample`,
              }
        }
      />
    </Figure>
  )
}

// ---------------------------------------------------------------- 8.3

export function LoadFigure({ data, fetching, profile }: ProfileProps) {
  const head = {
    index: '8.3',
    title: 'Training load',
    caption: 'Banister’s training impulse, summed over each week’s workouts. Hover a week to see the sessions behind it.',
    method: {
      body: (
        <>
          <p>Each workout minute is weighted by its heart-rate reserve fraction r, clipped to 0–1: TRIMP = Σ minutes × r × 0.64·e^(1.92·r) for men, or 0.86·e^(1.67·r) for women. The exponential weighting makes a hard minute count several times an easy one.</p>
          <p>Heart rate comes from the minute grid between each workout’s start and end; HRrest and HRmax are as in Fig. 8.2. Minutes covered by two overlapping workouts, such as one session logged by two apps, count once in the week.</p>
        </>
      ),
      cite: 'Morton RH, Fitz-Clarke JR, Banister EW. Modeling human performance in running. J Appl Physiol 1990;69:1171–1177.',
    } satisfies MethodNote,
  }
  if (!data || !profile) return <FigureSkeleton height={240} />
  if (data.hrmax == null || data.sex == null) {
    return (
      <Figure {...head}>
        <ProfileForm profile={profile} prompt="Training impulse uses heart-rate reserve and weights it with sex-specific coefficients. Add your birth date and sex to compute it." />
      </Figure>
    )
  }
  const vals = data.trimp.filter(isNum)
  const top = data.trimp.reduce<number>((b, v, k) => ((v ?? 0) > (data.trimp[b] ?? 0) ? k : b), 0)
  const n = data.workouts.reduce((s, w) => s + w.length, 0)
  if (n === 0) {
    return (
      <Figure {...head}>
        <EmptyState title="No workouts in this range">Workouts started on the watch appear here with the load they carried.</EmptyState>
      </Figure>
    )
  }
  return (
    <Figure
      {...head}
      fetching={fetching}
      reading={
        <>
          A median week carries a load of <span className="num">{fixed(median(vals), 0)}</span> from {n} workouts in the range; the heaviest, the week of {formatDate(data.weeks[top], { year: true })}, reached{' '}
          <span className="num">{fixed(data.trimp[top], 0)}</span> over {data.workouts[top].length} sessions.
        </>
      }
    >
      <WeekBars
        weeks={data.weeks}
        weekDays={data.week_days}
        stacks={[{ key: 'trimp', label: 'TRIMP', color: LOAD, values: data.trimp }]}
        format={(v) => fixed(v, 0)}
        label="Training impulse per week"
        hover={(k) => ({
          rows: [{ label: `TRIMP · ${data.workouts[k].length} workouts`, value: fixed(data.trimp[k], 0), color: LOAD, kind: 'swatch' }],
          footer: <WorkoutList items={data.workouts[k]} trimp />,
        })}
      />
    </Figure>
  )
}

// ---------------------------------------------------------------- 8.4

export function StrengthFigure({ data, fetching }: FigureProps) {
  const head = {
    index: '8.4',
    title: 'Muscle strengthening',
    caption: 'Days per week with at least one strength workout, against the WHO recommendation of two or more.',
    method: {
      body: <p>A day counts once however many sessions it holds. Strength workouts are those logged as traditional strength training, functional strength training or core training.</p>,
      cite: WHO,
    } satisfies MethodNote,
  }
  if (!data) return <FigureSkeleton height={200} />
  const weeks = data.strength_days.length
  const met = data.strength_days.filter((d) => d >= 2).length
  const any = data.strength_days.some((d) => d > 0)
  return (
    <Figure
      {...head}
      fetching={fetching}
      reading={
        any ? (
          <>
            Strength training on two or more days in {met} of {weeks} weeks ({share(met, weeks)}), and on at least one day in {data.strength_days.filter((d) => d > 0).length}.
          </>
        ) : undefined
      }
    >
      {any ? (
        <WeekBars
          weeks={data.weeks}
          weekDays={data.week_days}
          stacks={[{ key: 'days', label: 'Strength days', color: STRENGTH, values: data.strength_days }]}
          refLines={[{ y: 2, label: '2 days' }]}
          domainMax={7}
          height={200}
          format={(v) => fixed(v, 0)}
          label="Days per week with a strength workout"
          hover={(k) => ({
            rows: [{ label: data.strength_days[k] === 1 ? 'day' : 'days', value: String(data.strength_days[k]), color: STRENGTH, kind: 'swatch' }],
            footer: <WorkoutList items={data.workouts[k].filter((w) => w.strength)} trimp={false} />,
          })}
        />
      ) : (
        <EmptyState title="No strength workouts in this range">Strength, functional strength and core training workouts logged on the watch count here.</EmptyState>
      )}
    </Figure>
  )
}

// ---------------------------------------------------------------- 8.5

const STEP_KEYS = [K.steps] as const

export function StepsFigure({ data, profile }: ProfileProps) {
  const { range } = useObservatory()
  const q = useDaily(range, STEP_KEYS)
  const head = {
    index: '8.5',
    title: 'Steps against the evidence',
    caption: 'Daily steps with a rolling median, and the shaded range where the mortality benefit of more steps levels off.',
    method: {
      body: (
        <>
          <p>A meta-analysis of 15 cohorts found the risk of death falling with more daily steps up to a plateau: about 6,000–8,000 steps a day for adults 60 and over, and 8,000–10,000 for younger adults.</p>
          <p>The band is the one for your age; without an age both are drawn. Steps take the maximum across sources in each 10-minute bin, summed per day.</p>
        </>
      ),
      cite: 'Paluch AE et al. Daily steps and all-cause mortality: a meta-analysis of 15 international cohorts. Lancet Public Health 2022;7:e219–e228.',
    } satisfies MethodNote,
  }
  if (q.isPending || !data || !profile) return <FigureSkeleton height={220} />
  const steps = q.data?.columns[K.steps] ?? []
  const vals = steps.filter(isNum)
  if (q.isError || !vals.length) {
    return (
      <Figure {...head}>
        <EmptyState title="No steps in this range">{q.error?.message ?? 'The phone and watch recorded no steps for these days.'}</EmptyState>
      </Figure>
    )
  }
  const bands = data.steps_bands
  const one = bands.length === 1 ? bands[0] : null
  const hi = Math.max(...bands.map((b) => b.hi), [...vals].sort((a, b) => a - b)[Math.floor(vals.length * 0.98)])
  const med = median(vals)
  return (
    <Figure
      {...head}
      fetching={q.isPlaceholderData && q.isFetching}
      reading={
        one ? (
          <>
            Median <span className="num">{fixed(med, 0)}</span> steps a day; {share(vals.filter((v) => v >= one.lo).length, vals.length)} of days reached {fixed(one.lo, 0)}, the lower edge of the plateau for adults {one.label.toLowerCase()}.
          </>
        ) : (
          <>
            Median <span className="num">{fixed(med, 0)}</span> steps a day. Which band applies depends on age.
          </>
        )
      }
      legend={<Legend items={[{ label: 'Steps, 14-day median', color: METRIC_COLOR[K.steps], kind: 'band' }]} />}
    >
      <BandChart
        days={q.data!.days}
        series={[{ key: K.steps, label: 'Steps', color: METRIC_COLOR[K.steps], values: steps, window: 14 }]}
        height={220}
        domain={[0, Math.ceil((hi * 1.08) / 2000) * 2000]}
        format={compact}
        valueFormat={(v) => (v == null ? '—' : `${fixed(v, 0)} steps`)}
        refBands={bands.map((b) => ({ from: b.lo, to: b.hi, label: `${b.label} · ${compact(b.lo)}–${compact(b.hi)}` }))}
        refLines={one ? [] : [{ y: bands[0].lo, label: '' }]}
        label="Daily steps"
      />
      {!one && (
        <div className="mt-6 border-t border-hairline pt-5">
          <ProfileForm profile={profile} boxed={false} prompt="Add your birth date to keep only the band for your age." />
        </div>
      )}
    </Figure>
  )
}

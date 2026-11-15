import { ChapterPage } from '@/app/ChapterPage'
import { useObservatory } from '@/app/context'
import { K } from '@/core/metrics'
import { useFitness, useProfile } from '@/infra/queries'
import { MetricPanelsFigure, type MetricFigureSpec, type MetricSummary } from '@/features/mobility/MetricPanels'
import { AerobicFigure, IntensityFigure, LoadFigure, StepsFigure, StrengthFigure } from './figures'
import { ProfileLine } from './Profile'

const CAPACITY: MetricFigureSpec = {
  index: '8.6',
  title: 'Cardiorespiratory fitness',
  caption: 'The watch’s VO2max estimate, heart-rate recovery one minute after workouts, and average heart rate while walking. Each dot is one day; the line is a rolling median.',
  method: {
    body: (
      <>
        <p>
          VO2max is estimated by the watch during outdoor walks, runs and hikes. In a meta-analysis of 33 cohorts, each 1 MET (3.5 mL/min·kg) of higher fitness went with about 13% lower all-cause mortality. The
          watch’s estimate differs from a laboratory test by about 13% on average, so its trend says more than its level.
        </p>
        <p>
          Heart-rate recovery is the drop in the first minute after a workout ends. On a treadmill exercise test, a drop of 12 bpm or less was abnormal; the watch measures it after ordinary workouts, so that
          figure is a reference point, not a verdict. Walking HR is the day’s average heart rate while walking. Each day is the mean of its samples.
        </p>
      </>
    ),
    cite: 'Kodama S et al. Cardiorespiratory fitness as a quantitative predictor of all-cause mortality and cardiovascular events. JAMA 2009;301:2024–2035. Lambe R et al. PLOS ONE 2025. Cole CR et al. Heart-rate recovery immediately after exercise as a predictor of mortality. N Engl J Med 1999;341:1351–1357.',
  },
  metrics: [K.vo2max, K.hrr1, K.walkingHr],
  cols: 3,
  empty: 'The watch estimates these during outdoor walks, runs and workouts; none were recorded in this range.',
}

const phrase = (s: MetricSummary, hasPrev: boolean) => `${s.label} ${s.value}${hasPrev && s.delta ? ` (${s.delta})` : ''}`

function capacityReading(s: MetricSummary[], hasPrev: boolean) {
  const seen = s.filter((r) => r.coverage > 0)
  return (
    <>
      Median {seen.map((r) => phrase(r, hasPrev)).join(', ')}
      {hasPrev ? ', against the previous period of equal length.' : '; no earlier period of equal length to compare.'}
    </>
  )
}

export default function Page() {
  const { range } = useObservatory()
  const fit = useFitness(range)
  const profile = useProfile()
  const fetching = fit.isPlaceholderData && fit.isFetching
  const p = { data: fit.data, fetching }
  return (
    <ChapterPage
      lede={
        <>
          <p>
            How much you move, how hard, and what it builds. These figures set each week against the WHO activity guidelines, weigh every workout by the heart rate it raised, and follow the watch’s
            estimates of cardiorespiratory fitness.
          </p>
          <ProfileLine profile={profile.data} />
        </>
      }
    >
      <AerobicFigure {...p} />
      <IntensityFigure {...p} profile={profile.data} />
      <LoadFigure {...p} profile={profile.data} />
      <StrengthFigure {...p} />
      <StepsFigure {...p} profile={profile.data} />
      <MetricPanelsFigure spec={CAPACITY} reading={capacityReading} />
    </ChapterPage>
  )
}

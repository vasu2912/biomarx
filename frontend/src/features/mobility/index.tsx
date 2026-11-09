import { ChapterPage } from '@/app/ChapterPage'
import { K } from '@/core/metrics'
import { MetricPanelsFigure, type MetricFigureSpec, type MetricSummary } from './MetricPanels'
import { WeeklyShapeFigure } from './WeeklyShape'

const phrase = (s: MetricSummary, hasPrev: boolean) => `${s.label.toLowerCase()} ${s.value}${hasPrev && s.delta ? ` (${s.delta})` : ''}`

function readingFor(s: MetricSummary[], hasPrev: boolean) {
  const sparse = s.filter((r) => r.window > 14)
  return (
    <>
      Median {s.map((r) => phrase(r, hasPrev)).join(', ')}
      {hasPrev ? ', against the previous period of equal length.' : '; no earlier period of equal length to compare.'}
      {sparse.length > 0 && ` ${sparse.map((r) => r.label).join(' and ')} cover under 60% of days, so their median uses a 28-day window.`}
    </>
  )
}

const FIGURES: readonly MetricFigureSpec[] = [
  {
    index: '6.1',
    title: 'Gait',
    caption: 'Each dot is one day’s median from the phone’s walking measurements; the line is a rolling median and the ribbon its interquartile range. Changes are against the previous period.',
    method: {
      body: (
        <>
          <p>iPhone measures walking speed, step length, double-support time and asymmetry passively during steady walks while carried at the hip or in a pocket. Each day is the median of that day’s samples.</p>
          <p>The rolling window is 14 days when a metric has a value on at least 60% of days, otherwise 28 days.</p>
        </>
      ),
      cite: 'Studenski S et al. Gait speed and survival in older adults. JAMA 2011;305:50–58.',
    },
    metrics: [K.walkSpeed, K.stepLength, K.doubleSupport, K.asymmetry],
    cols: 2,
    empty: 'Gait is measured by the phone during steady walks; none were recorded in this range.',
  },
  {
    index: '6.2',
    title: 'Daily activity',
    caption: 'Steps and active energy per day with a rolling median and interquartile range, on separate scales.',
    method: {
      body: <p>Steps take the maximum across sources in each 10-minute bin, summed per day. Active energy is the day’s total from the watch.</p>,
    },
    metrics: [K.steps, K.activeKcal],
    cols: 2,
    empty: 'No steps or active energy were recorded in this range.',
  },
]

export default function Page() {
  return (
    <ChapterPage
      lede={
        <p>
          How fast and how evenly you walk tracks health closely enough to be called the sixth vital sign. These figures follow the gait the phone measures in passing, the volume of
          daily movement, and when in the week and the day it happens.
        </p>
      }
    >
      {FIGURES.map((f) => (
        <MetricPanelsFigure key={f.index} spec={f} reading={readingFor} />
      ))}
      <WeeklyShapeFigure />
    </ChapterPage>
  )
}

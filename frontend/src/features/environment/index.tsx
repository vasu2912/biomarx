import { ChapterPage } from '@/app/ChapterPage'
import { useObservatory } from '@/app/context'
import { K } from '@/core/metrics'
import { useEnvironment } from '@/infra/queries'
import { MetricPanelsFigure, type MetricFigureSpec, type MetricSummary } from '@/features/mobility/MetricPanels'
import { SeasonsFigure, SoundFigure } from './figures'

const BURNS_WRIGHT =
  'Background: Burns AC et al. Day and night light exposure are associated with psychiatric disorders. Nat Ment Health 2023. Wright KP Jr et al. Entrainment of the human circadian clock to the natural light-dark cycle. Curr Biol 2013;23:1554–1558.'

const DAYLIGHT: MetricFigureSpec = {
  index: '9.1',
  title: 'Daylight',
  caption: 'Minutes in daylight each day, and in the first two hours after waking. Each dot is one day; the line is a rolling median and the ribbon its interquartile range.',
  method: {
    body: (
      <>
        <p>
          Time in daylight is the Apple Watch’s estimate of time spent outdoors in daylight, from its ambient light sensor. It is measured only while that watch is on the wrist, so a day counts
          only when it was worn for at least 60% of the day; a day without it is missing, not zero.
        </p>
        <p>
          Morning daylight is the share of those minutes in the first two hours after the wake time that began the day. A sample that straddles the edge counts for the part inside, and a
          morning counts only when the watch was worn for at least half of the two hours.
        </p>
        <p>Light by day, and in the morning especially, is the main signal that sets the circadian clock. There is no accepted target number of minutes, so none is drawn.</p>
      </>
    ),
    cite: BURNS_WRIGHT,
  },
  metrics: [K.daylight, K.morningDaylight],
  cols: 2,
  empty: 'The watch logs time in daylight from watchOS 10, while it is worn; none was recorded in this range.',
}

const phrase = (s: MetricSummary, hasPrev: boolean) => `${s.label.toLowerCase()} ${s.value}${hasPrev && s.delta ? ` (${s.delta})` : ''}`

function daylightReading(s: MetricSummary[], hasPrev: boolean) {
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
  const env = useEnvironment(range)
  const p = { data: env.data, fetching: env.isPlaceholderData && env.isFetching, error: env.error?.message }
  return (
    <ChapterPage
      lede={
        <p>
          What the surroundings pour in. These figures follow the daylight the watch senses, how the turn of the year shows in your light, sleep and heart rate, and the dose of sound
          that reaches your ears against the WHO safe-listening allowance.
        </p>
      }
    >
      <MetricPanelsFigure spec={DAYLIGHT} reading={daylightReading} />
      <SeasonsFigure {...p} />
      <SoundFigure {...p} />
    </ChapterPage>
  )
}

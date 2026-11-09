import { ChapterPage } from '@/app/ChapterPage'
import { ramps } from '@/core/color'
import { clock } from '@/core/time'
import { fixed } from '@/core/format'
import { isNum } from '@/core/stats'
import { ActogramFigure, fmtBpm, fmtSteps, type ActogramModel, type ActogramSpec } from './Actogram'
import { CosinorFigure, NpcraFigure } from './Daily'
import { PeriodogramFigure } from './Periodogram'

function extremes(hourly: readonly (number | null)[]) {
  let lo = -1
  let hi = -1
  hourly.forEach((v, h) => {
    if (!isNum(v)) return
    if (lo < 0 || v < hourly[lo]!) lo = h
    if (hi < 0 || v > hourly[hi]!) hi = h
  })
  return { lo, hi }
}

const ACTOGRAMS: readonly ActogramSpec[] = [
  {
    index: '3.1',
    title: 'Heart-rate actogram',
    caption: 'One row per day, midnight to midnight, in 5-minute bins; brighter is faster. Dark gaps are hours the watch was off.',
    method: {
      body: (
        <p>
          Heart rate per 5-minute bin, de-duplicated to the source with the most samples each day. Colour limits are the 2nd and 98th percentiles of the range, so a few
          workouts do not wash out the night-day contrast.
        </p>
      ),
    },
    raster: 'hr5',
    ramp: (t) => ramps.ember(0.12 + 0.88 * t),
    scale: 'linear',
    zeroIsMissing: true,
    unit: 'bpm',
    legendLabel: 'Heart rate, bpm',
    format: fmtBpm,
    reading: (m: ActogramModel) => {
      const { lo, hi } = extremes(m.hourly)
      return (
        <>
          Across {m.daysWithData} days with data, heart rate averages {fixed(m.hourly[lo], 0)} bpm in the {clock(lo)} hour and climbs to {fixed(m.hourly[hi], 0)} bpm in the{' '}
          {clock(hi)} hour.
        </>
      )
    },
  },
  {
    index: '3.2',
    title: 'Activity actogram',
    caption: 'One row per day in 10-minute bins of steps; colour follows the square root of the count so short walks stay visible next to long ones.',
    method: {
      body: (
        <p>
          Steps per 10-minute bin, taking the maximum across sources in each bin. Colour runs from zero to the 98th percentile of bins on a square-root scale; anything above is
          drawn at full brightness.
        </p>
      ),
    },
    raster: 'steps10',
    ramp: ramps.sun,
    scale: 'sqrt',
    zeroIsMissing: false,
    unit: 'steps',
    legendLabel: 'Steps per 10 min, √ scale',
    format: fmtSteps,
    reading: (m: ActogramModel) => {
      const { lo, hi } = extremes(m.hourly)
      return (
        <>
          The busiest hour is {clock(hi)}, averaging {fmtSteps((m.hourly[hi] ?? 0) * 6)} steps; the stillest is {clock(lo)} at {fmtSteps((m.hourly[lo] ?? 0) * 6)} steps.
        </>
      )
    },
  },
]

export default function Page() {
  return (
    <ChapterPage
      lede={
        <p>
          The body keeps a roughly 24-hour clock. Heart rate and movement are its two most continuous outputs: these figures show how regular that clock is, when it peaks, and
          whether anything other than the day is setting the beat.
        </p>
      }
    >
      {ACTOGRAMS.map((s) => (
        <ActogramFigure key={s.index} spec={s} />
      ))}
      <CosinorFigure />
      <NpcraFigure />
      <PeriodogramFigure />
    </ChapterPage>
  )
}

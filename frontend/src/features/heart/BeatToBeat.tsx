import { scaleLinear } from 'd3-scale'
import { area, line } from 'd3-shape'
import { SIGNAL, withAlpha } from '@/core/color'
import type { BeatToBeat } from '@/core/domain'
import { fixed } from '@/core/format'
import { extent, isNum } from '@/core/stats'
import { BandChart } from '@/ui/charts/BandChart'
import { Figure, FigureSkeleton, Legend } from '@/ui/charts/Figure'
import { EmptyState } from '@/ui/primitives'

const COLOR = SIGNAL.hrv
const BASE = SIGNAL.ink2

export function BeatToBeatFigure({ data, fetching }: { data: BeatToBeat | undefined; fetching: boolean }) {
  if (!data) return <FigureSkeleton height={260} />
  const nights = data.ln_rmssd.filter(isNum).length
  const lo = data.median.map((m, i) => (m == null || data.scale[i] == null ? null : m - data.scale[i]!))
  const hi = data.median.map((m, i) => (m == null || data.scale[i] == null ? null : m + data.scale[i]!))
  const last = data.mean7.findLastIndex(isNum)
  const m7 = last >= 0 ? data.mean7[last]! : null
  const place = m7 == null || lo[last] == null ? null : m7 < lo[last]! ? 'below' : m7 > hi[last]! ? 'above' : 'inside'

  return (
    <Figure
      index="4.8"
      title="Night HRV, beat to beat"
      caption={`RMSSD worked out from the beat times inside the watch’s HRV readings during sleep, as its natural log. The line is the ${data.rolling_nights}-night rolling mean; the band is your own baseline over the ${data.baseline_nights} nights before each night.`}
      reading={
        nights && m7 != null ? (
          <>
            The latest {data.rolling_nights}-night mean is <b className="num">{fixed(m7, 2)}</b> (about {fixed(Math.exp(m7))} ms)
            {place && (
              <>
                , {place} the baseline of {fixed(lo[last], 2)}–{fixed(hi[last], 2)}
              </>
            )}
            . {fixed(nights)} {nights === 1 ? 'night' : 'nights'} in this range had beat lists.
          </>
        ) : undefined
      }
      legend={
        nights ? (
          <Legend
            items={[
              { label: 'ln RMSSD, one night', color: COLOR, kind: 'dot' },
              { label: `${data.rolling_nights}-night mean`, color: COLOR, kind: 'line' },
              { label: `${data.baseline_nights}-night baseline, median ± 1.4826 MAD`, color: BASE, kind: 'band' },
            ]}
          />
        ) : undefined
      }
      method={{
        body: (
          <>
            <p>
              The watch keeps the time of each beat inside every HRV reading. RR intervals are the gaps between successive beats, and RMSSD is the square root of the mean
              squared difference between successive RR intervals. An RR shorter than {fixed(data.min_rr_ms)} ms or longer than {fixed(data.max_rr_ms)} ms is dropped, along
              with every successive difference it takes part in; a reading needs at least {data.min_diffs} valid differences, otherwise it gives no value. These filters are
              the rule used here.
            </p>
            <p>
              Apple takes these readings at rest at scattered times of day, so a night’s RMSSD is the mean over the readings that start inside the main sleep episode, on
              nights with at least two of them. The beat times resolve to 10 ms, coarser than the 250–500 Hz sampling the Task Force recommends, so values are approximate.
            </p>
            <p>
              The line is the mean of ln RMSSD over the night and the {data.rolling_nights - 1} before it, shown when at least {data.min_rolling_nights} of them have a value.
              The band is the median of the {data.baseline_nights} nights before, ± 1.4826 × their median absolute deviation, the same baseline as Fig. 4.7, with at least{' '}
              {data.min_baseline_nights} nights.
            </p>
            <p>Apple’s own HRV figure, used in Figs. 4.2 and 4.7, is SDNN, the standard deviation of the RR intervals: a different statistic from RMSSD.</p>
          </>
        ),
        cite: 'Task Force of the ESC and NASPE. Circulation 1996;93:1043–1065. Plews DJ et al. Sports Med 2013;43:773–781. Leys C et al. J Exp Soc Psychol 2013;49:764–766.',
      }}
      fetching={fetching}
    >
      {!data.available ? (
        <EmptyState title="No beat times in this database">Re-import your export to read beat-to-beat data.</EmptyState>
      ) : !nights ? (
        <EmptyState title="No nights with beat lists">The watch kept no beat-to-beat readings inside a main sleep episode in this range. Try a longer range.</EmptyState>
      ) : (
        <Chart data={data} lo={lo} hi={hi} />
      )}
    </Figure>
  )
}

function Chart({ data, lo, hi }: { data: BeatToBeat; lo: (number | null)[]; hi: (number | null)[] }) {
  const v = data.ln_rmssd.filter(isNum).sort((a, b) => a - b)
  const e = extent([v[Math.floor(v.length * 0.02)], v[Math.floor(v.length * 0.98)], ...lo, ...hi, ...data.mean7], 0.08) ?? [0, 1]
  const domain = scaleLinear().domain(e).nice(4).domain() as [number, number]
  return (
    <BandChart
      days={data.days}
      series={[
        {
          key: 'ln_rmssd',
          label: 'ln RMSSD',
          color: COLOR,
          values: data.ln_rmssd,
          dotsOnly: true,
          hoverSub: (i) =>
            [data.rmssd[i] != null && `${fixed(data.rmssd[i])} ms`, data.mean7[i] != null && `${data.rolling_nights}-night ${fixed(data.mean7[i], 2)}`]
              .filter(Boolean)
              .join(' · ') || undefined,
        },
      ]}
      height={240}
      domain={domain}
      format={(x) => fixed(x, 1)}
      valueFormat={(x) => fixed(x, 2)}
      label="Night ln RMSSD with its rolling mean and baseline"
      annotate={({ x, y }) => {
        const band = area<number>()
          .defined((i) => lo[i] != null)
          .x((i) => x(i))
          .y0((i) => y(lo[i]!))
          .y1((i) => y(hi[i]!))
        const mean = line<number | null>()
          .defined((m) => m != null)
          .x((_, i) => x(i))
          .y((m) => y(m!))
        return (
          <g pointerEvents="none">
            <path d={band(data.days.map((_, i) => i)) ?? ''} fill={withAlpha(BASE, 0.12)} />
            <path d={mean(data.mean7) ?? ''} fill="none" stroke={COLOR} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
          </g>
        )
      }}
    />
  )
}

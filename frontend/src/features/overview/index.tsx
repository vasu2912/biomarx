import { useMemo } from 'react'
import { ChapterPage } from '@/app/ChapterPage'
import { useObservatory } from '@/app/context'
import { formatMetric, unitSuffix } from '@/core/format'
import { def, K } from '@/core/metrics'
import { isNum } from '@/core/stats'
import type { Sources } from '@/core/domain'
import { formatDate, formatRange } from '@/core/time'
import { useDaily, useRaster, useSources, useSummary } from '@/infra/queries'
import { Figure, FigureSkeleton, Legend } from '@/ui/charts/Figure'
import { EmptyState } from '@/ui/primitives'
import { Actogram, ACTOGRAM_LEGEND } from './Actogram'
import { FourTrends, TREND_KEYS, TREND_LEGEND } from './FourTrends'
import { SourceStrips, sourceLegend } from './Sources'
import { buildVitals, VITAL_KEYS, VitalSigns } from './VitalSigns'

const DAILY_KEYS = [...new Set([...VITAL_KEYS, ...TREND_KEYS])]

const refetching = (q: { isFetching: boolean; isPending: boolean }) => q.isFetching && !q.isPending

export default function Page() {
  const { registry, range, prev } = useObservatory()
  const summary = useSummary(range)
  const prevSummary = useSummary(prev)
  const daily = useDaily(range, DAILY_KEYS)
  const raster = useRaster('sleep', range)
  const sources = useSources(range)

  const vitals = useMemo(
    () => (summary.data ? buildVitals(registry, summary.data, prevSummary.data, daily.data) : null),
    [registry, summary.data, prevSummary.data, daily.data],
  )

  const sleepReading = useMemo(() => {
    const v = summary.data?.values
    if (!v || !isNum(v.nights) || !v.nights) return null
    return `Median onset ${formatMetric(def(registry, K.onset), v[K.onset])} and median total sleep ${formatMetric(def(registry, K.tst), v[K.tst])}, over ${fmtInt(v.nights)} nights.`
  }, [summary.data, registry])

  const trendReading = useMemo(() => {
    const v = summary.data?.values
    if (!v) return null
    const parts = TREND_KEYS.flatMap((k) => {
      const m = def(registry, k)
      const suffix = unitSuffix(m)
      return isNum(v[k]) ? [`${m.label} ${formatMetric(m, v[k])}${suffix ? ` ${suffix}` : ''}`] : []
    })
    return parts.length ? `Range medians: ${parts.join(', ')}.` : null
  }, [summary.data, registry])

  const s = summary.data?.values
  const lede = s
    ? `${fmtInt(s.nights)} nights tracked across ${fmtInt(s.valid_days)} valid days, ${formatRange(range.start, range.end)}.`
    : undefined

  const sleepRaster = raster.data && raster.data.data instanceof Uint8Array ? { ...raster.data, data: raster.data.data } : null
  const hasDaily = (daily.data?.days.length ?? 0) > 0

  return (
    <ChapterPage lede={lede}>
      {vitals ? (
        <Figure
          index="1.1"
          title="Vital signs"
          caption="Range value of each headline metric, its change against the equal-length period before, and its weekly mean across the range."
          reading={vitalsReading(vitals)}
          method={{
            body: (
              <>
                <p>Each value is the median across the range (sleep regularity is the mean). Clock times are medians of evening-unwrapped hours, so a 23:30 and a 00:30 onset average to midnight. Rhythm values skip days whose cosinor fit has R² under 0.15.</p>
                <p>The delta compares against the equal-length period just before the range. Green and red say whether the move is in the healthy direction; clock times have no direction.</p>
                <p>The sparkline is the mean of each 7-day block.</p>
              </>
            ),
          }}
          fetching={refetching(summary) || refetching(daily)}
        >
          <VitalSigns groups={vitals} hasPrev={prev != null} />
        </Figure>
      ) : summary.isError ? (
        <EmptyState title="Summary unavailable">{summary.error.message}</EmptyState>
      ) : (
        <FigureSkeleton height={360} />
      )}

      {sleepRaster ? (
        <Figure
          index="1.2"
          title="Actogram"
          caption="One row per day, midnight to midnight. Color marks the sleep stage of each minute; dark gaps are minutes without the watch."
          reading={sleepReading ?? undefined}
          legend={<Legend items={ACTOGRAM_LEGEND} />}
          method={{
            body: (
              <>
                <p>Minute stages come from the sleep source with the most staged minutes each night. A minute counts as worn when a heart rate sample lies within 15 minutes.</p>
                <p>Onset is the median start of the main sleep episode; total sleep is the median of its Core, REM and Deep minutes. Nights under 3 h of sleep do not count.</p>
              </>
            ),
          }}
          fetching={refetching(raster)}
        >
          {sleepRaster.rows > 0 ? <Actogram raster={sleepRaster} /> : <EmptyState title="No days in this range" />}
        </Figure>
      ) : raster.isError ? (
        <EmptyState title="Sleep raster unavailable">{raster.error.message}</EmptyState>
      ) : (
        <FigureSkeleton height={480} />
      )}

      {daily.data ? (
        <Figure
          index="1.3"
          title="Four trends"
          caption="Daily values with a centered 14-day median and its interquartile band. Each panel has its own scale; hovering one marks the same day in all."
          reading={trendReading ?? undefined}
          legend={<Legend items={TREND_LEGEND} />}
          method={{
            body: <p>The rolling window is centered, 14 days wide, and needs at least 4 valid days to draw. Dots outside the 2nd to 98th percentile are clipped from the scale.</p>,
          }}
          fetching={refetching(daily)}
        >
          {hasDaily ? <FourTrends daily={daily.data} registry={registry} /> : <EmptyState title="No daily data in this range" />}
        </Figure>
      ) : daily.isError ? (
        <EmptyState title="Daily series unavailable">{daily.error.message}</EmptyState>
      ) : (
        <FigureSkeleton height={420} />
      )}

      {sources.data ? (
        <Figure
          index="1.4"
          title="Where the data came from"
          caption="One row per kind of record and one cell per day, colored by the source that supplied it. Hover a day to name each source; the same day is marked in the trends above."
          reading={sourcesReading(sources.data)}
          legend={<Legend items={sourceLegend(sources.data)} />}
          method={{
            body: (
              <>
                <p>
                  Each cell names the source the pipeline used for that record on that day. Heart rate comes from the source with the most samples that day, and only its samples build the
                  minute grid. Sleep comes from the source with the most staged minutes that night, placed on day D for the night that starts after noon on day D. Steps take the maximum
                  across sources in each 10-minute bin; the cell shows the source with the most steps that day. HRV, SpO2 and daylight pool every source, and the cell shows the one with the
                  most samples.
                </p>
                <p>
                  A change of device can shift a baseline: sensors, algorithms and sampling differ between them. Before reading a step change in another figure as a change in you, check
                  whether the source changed here on the same day. The reading dates the last switch of heart-rate source that held, ignoring runs of another source shorter than a week.
                </p>
              </>
            ),
          }}
          fetching={refetching(sources)}
        >
          {sources.data.days.length > 0 ? <SourceStrips data={sources.data} /> : <EmptyState title="No days in this range" />}
        </Figure>
      ) : sources.isError ? (
        <EmptyState title="Sources unavailable">{sources.error.message}</EmptyState>
      ) : (
        <FigureSkeleton height={200} />
      )}
    </ChapterPage>
  )
}

function fmtInt(v: number | null | undefined) {
  return isNum(v) ? Math.round(v).toLocaleString('en-US') : '0'
}

function sourcesReading(d: Sources): string | undefined {
  const days = d.sources.map(() => new Set<number>())
  d.families.forEach((f) => f.source.forEach((s, i) => s != null && days[s].add(i)))
  const top = days.reduce((b, s, i) => (s.size > days[b].size ? i : b), 0)
  if (!days[top]?.size) return undefined
  // Runs of heart-rate source over recorded days; the current source took over after the last run of another lasting a week or more.
  const hr = d.families.find((f) => f.key === 'hr')?.source ?? []
  const runs: { src: number; start: number; n: number }[] = []
  hr.forEach((s, i) => {
    if (s == null) return
    const last = runs[runs.length - 1]
    if (last?.src === s) last.n++
    else runs.push({ src: s, start: i, n: 1 })
  })
  const cur = (runs.findLast((r) => r.n >= 7) ?? runs[runs.length - 1])?.src
  const lastOther = runs.findLastIndex((r) => r.src !== cur && r.n >= 7)
  const since = lastOther < 0 ? undefined : runs.slice(lastOther).find((r) => r.src === cur)
  const hrPart =
    cur == null
      ? ''
      : since
        ? ` Heart rate has come mainly from ${d.sources[cur]} since ${formatDate(d.days[since.start], { year: true })}.`
        : runs.length === 1
          ? ` Heart rate came from ${d.sources[cur]} on every day it was recorded.`
          : ` Heart rate came mainly from ${d.sources[cur]} throughout the range.`
  return `${d.sources[top]} supplied records on ${fmtInt(days[top].size)} of ${fmtInt(d.days.length)} days in this range.${hrPart}`
}

function vitalsReading(groups: ReturnType<typeof buildVitals>): string | undefined {
  const tiles = groups.flatMap((g) => g.tiles)
  const good = tiles.filter((t) => !t.flat && t.tone === 'good').length
  const bad = tiles.filter((t) => !t.flat && t.tone === 'bad').length
  if (!good && !bad) return undefined
  return `${good} of ${tiles.length} vitals moved in the healthy direction against the prior period, ${bad} moved against it.`
}

import { useMemo } from 'react'
import { ChapterPage } from '@/app/ChapterPage'
import { useObservatory } from '@/app/context'
import { formatMetric, unitSuffix } from '@/core/format'
import { def, K } from '@/core/metrics'
import { isNum } from '@/core/stats'
import { formatRange } from '@/core/time'
import { useDaily, useRaster, useSummary } from '@/infra/queries'
import { Figure, FigureSkeleton, Legend } from '@/ui/charts/Figure'
import { EmptyState } from '@/ui/primitives'
import { Actogram, ACTOGRAM_LEGEND } from './Actogram'
import { FourTrends, TREND_KEYS, TREND_LEGEND } from './FourTrends'
import { buildVitals, VITAL_KEYS, VitalSigns } from './VitalSigns'

const DAILY_KEYS = [...new Set([...VITAL_KEYS, ...TREND_KEYS])]

const refetching = (q: { isFetching: boolean; isPending: boolean }) => q.isFetching && !q.isPending

export default function Page() {
  const { registry, range, prev } = useObservatory()
  const summary = useSummary(range)
  const prevSummary = useSummary(prev)
  const daily = useDaily(range, DAILY_KEYS)
  const raster = useRaster('sleep', range)

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
    </ChapterPage>
  )
}

function fmtInt(v: number | null | undefined) {
  return isNum(v) ? Math.round(v).toLocaleString('en-US') : '0'
}

function vitalsReading(groups: ReturnType<typeof buildVitals>): string | undefined {
  const tiles = groups.flatMap((g) => g.tiles)
  const good = tiles.filter((t) => !t.flat && t.tone === 'good').length
  const bad = tiles.filter((t) => !t.flat && t.tone === 'bad').length
  if (!good && !bad) return undefined
  return `${good} of ${tiles.length} vitals moved in the healthy direction against the prior period, ${bad} moved against it.`
}

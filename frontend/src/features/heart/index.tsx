import { ChapterPage } from '@/app/ChapterPage'
import { useObservatory } from '@/app/context'
import { fixed } from '@/core/format'
import { useDaily, useHrActivity, useNights } from '@/infra/queries'
import { BAND_FIGURES, BandFigure, DAILY_KEYS } from './bands'
import { DoseResponseFigure } from './DoseResponse'
import { RidgelineFigure } from './Ridgeline'

export default function Page() {
  const { range, registry } = useObservatory()
  const daily = useDaily(range, DAILY_KEYS)
  const nights = useNights(range)
  const hra = useHrActivity(range)
  const nNights = nights.data?.nights.length

  return (
    <ChapterPage
      lede={
        <p>
          What the heart does while you sleep: how low it settles, how variable it stays, how far it dips below the day, and how it answers movement
          when awake.{nNights != null && <> This range holds <span className="num text-ink">{fixed(nNights)}</span> main sleep episodes.</>}
        </p>
      }
    >
      {BAND_FIGURES.map((spec) => (
        <BandFigure key={spec.index} spec={spec} daily={daily.data} registry={registry} fetching={daily.isPlaceholderData} />
      ))}
      <DoseResponseFigure data={hra.data} fetching={hra.isPlaceholderData} />
      <RidgelineFigure data={hra.data} fetching={hra.isPlaceholderData} />
    </ChapterPage>
  )
}

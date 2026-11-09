import { ChapterPage } from '@/app/ChapterPage'
import { Actogram } from './Actogram'
import { Architecture } from './Architecture'
import { BAND_FIGURES, BandFigure } from './Bands'
import { Chronotype } from './Chronotype'

export default function Page() {
  return (
    <ChapterPage
      lede={
        <p className="max-w-[72ch]">
          Every night of the range, read from the raw minute stages up: when sleep falls on the clock, how long and how deep it runs, how a typical night is built,
          and how much the week bends it.
        </p>
      }
    >
      <Actogram />
      <BandFigure spec={BAND_FIGURES.timing} />
      <BandFigure spec={BAND_FIGURES.duration} />
      <BandFigure spec={BAND_FIGURES.composition} />
      <Architecture />
      <Chronotype />
      <BandFigure spec={BAND_FIGURES.regularity} />
    </ChapterPage>
  )
}

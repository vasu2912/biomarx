import { useMemo, useState } from 'react'
import { ChapterPage } from '@/app/ChapterPage'
import { useObservatory } from '@/app/context'
import { ramps, SIGNAL } from '@/core/color'
import type { Range } from '@/core/domain'
import { def, type Registry } from '@/core/metrics'
import { formatDate } from '@/core/time'
import { useCorrelation, useDaily, useStateMatrix } from '@/infra/queries'
import { Figure, FigureSkeleton, Legend, RampLegend } from '@/ui/charts/Figure'
import { EmptyState } from '@/ui/primitives'
import { CorrelationMatrix, rhoColor } from './CorrelationMatrix'
import { DOT, PairScatter, TREND } from './PairScatter'
import { StateRaster } from './StateRaster'
import { cellOf, corrModel, formatQ, formatRho, pairPoints, stateGrid, strongestPartner, Z_CLAMP, type Cell, type CorrModel, type Pair } from './model'

const MIN_POINTS = 10

const SPEARMAN_NOTE = (
  <p>
    Spearman’s ρ is the Pearson correlation of ranks, so it measures any monotone relationship and a single extreme day cannot dominate it. Each pair uses
    only the days where both metrics exist.
  </p>
)

const METHOD = {
  matrix: {
    body: (
      <>
        {SPEARMAN_NOTE}
        <p>
          The p-values of all pairs are adjusted together with the Benjamini–Hochberg procedure. A dot marks pairs whose false discovery rate q is below 0.05,
          so about one in twenty of the dotted cells is expected to be a fluke.
        </p>
        <p>Rows and columns follow average-linkage hierarchical clustering on the distance 1 − |ρ|, so metrics that move together, in either direction, sit next to each other.</p>
      </>
    ),
    cite: 'Benjamini & Hochberg 1995, J R Stat Soc B 57:289',
  },
  pair: {
    body: (
      <>
        {SPEARMAN_NOTE}
        <p>Each dot is one day. The line joins the medians of x and y within eight equal-count bins along x, a trend that bends where the data bends instead of forcing a straight fit.</p>
        <p>Axes span the 1st to 99th percentile of each metric; the few days beyond sit pinned to the edge.</p>
        <p>Clock metrics stay on a continuous scale that runs past midnight, so 01:00 sits after 23:00.</p>
      </>
    ),
  },
  state: {
    body: (
      <>
        <p>Each cell is a robust z-score: the day’s value minus the metric’s median over the range, divided by 1.4826 × the median absolute deviation. Medians keep a few extreme days from setting the scale.</p>
        <p>Color saturates at ±{Z_CLAMP}. Rows use the same clustered order as Fig. 5.1, so related metrics light up as blocks.</p>
      </>
    ),
  },
}

const pairText = (registry: Registry, c: Cell) => `${def(registry, c.a).label} and ${def(registry, c.b).label} (ρ = ${formatRho(c.rho)})`

function matrixReading(registry: Registry, m: CorrModel) {
  if (!m.nSig) return `None of the ${m.tested} pairs pass the false discovery threshold in this range.`
  const parts = [
    m.pos && `The strongest positive pair is ${pairText(registry, m.pos)}`,
    m.neg && `the strongest negative is ${pairText(registry, m.neg)}`,
  ].filter(Boolean)
  return `${parts.join('; ')}. ${m.nSig} of ${m.tested} pairs are significant.`
}

function Unavailable({ index, title, reason }: { index: string; title: string; reason: string }) {
  return (
    <Figure index={index} title={title}>
      <EmptyState title="Nothing to draw">{reason}</EmptyState>
    </Figure>
  )
}

export default function Page() {
  const { range, registry } = useObservatory()
  const corr = useCorrelation(range)
  const model = useMemo(() => (corr.data ? corrModel(corr.data) : null), [corr.data])
  const [picked, setPicked] = useState<Pair | null>(null)
  const def0 = model?.strongest ?? model?.cells.find((c) => c.rho != null) ?? null
  const pair = model && picked && cellOf(model, picked) ? picked : def0 && { a: def0.a, b: def0.b }

  const pickA = (key: string) => {
    if (!model) return
    const b = pair && pair.b !== key ? pair.b : pair && pair.a !== key ? pair.a : strongestPartner(model, key)
    if (b) setPicked({ a: key, b })
  }

  return (
    <ChapterPage
      lede={
        <p>
          Which of the nightly and daily measures rise and fall together. The matrix ranks every pair, the scatter opens one up day by day, and the state map shows
          when each metric was unusual for you.
        </p>
      }
    >
      <div className="grid gap-x-12 gap-y-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        {corr.isPending ? (
          <FigureSkeleton height={520} />
        ) : !model || model.tested === 0 ? (
          <Unavailable index="5.1" title="Correlation matrix" reason="Too few days with overlapping metrics in this range to correlate anything." />
        ) : (
          <Figure
            index="5.1"
            title="Correlation matrix"
            caption="Each cell is the rank correlation of two daily metrics. Orange rises together, blue moves in opposition. Click a cell to plot it."
            reading={matrixReading(registry, model)}
            legend={
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <RampLegend
                  ramp={ramps.diverging}
                  label="Spearman ρ"
                  ticks={[
                    { at: 0, label: '−1' },
                    { at: 0.5, label: '0' },
                    { at: 1, label: '+1' },
                  ]}
                />
                <Legend items={[{ label: 'FDR q < 0.05', color: SIGNAL.ink, kind: 'dot' }]} />
              </div>
            }
            method={METHOD.matrix}
            fetching={corr.isPlaceholderData}
          >
            <CorrelationMatrix model={model} registry={registry} pair={pair} onSelect={setPicked} />
          </Figure>
        )}
        {model && pair ? <PairFigure range={range} registry={registry} pair={pair} cell={cellOf(model, pair)} /> : corr.isPending && <FigureSkeleton height={380} />}
      </div>
      <StateFigure range={range} registry={registry} marked={pair ? [pair.a, pair.b] : []} onPick={pickA} />
    </ChapterPage>
  )
}

function PairFigure({ range, registry, pair, cell }: { range: Range; registry: Registry; pair: Pair; cell: Cell | null }) {
  const keys = useMemo(() => [pair.a, pair.b], [pair.a, pair.b])
  const daily = useDaily(range, keys)
  const points = useMemo(() => (daily.data ? pairPoints(daily.data, pair) : []), [daily.data, pair])
  const dA = def(registry, pair.a)
  const dB = def(registry, pair.b)
  const title = `${dA.label} and ${dB.label}`
  if (daily.isPending) return <FigureSkeleton height={380} />
  if (points.length < MIN_POINTS) return <Unavailable index="5.2" title={title} reason={`Only ${points.length} days have both metrics in this range.`} />
  const rho = cell?.rho ?? null
  const verdict = !cell?.sig ? 'not distinguishable from noise' : rho! > 0 ? 'they tend to rise together' : 'one tends to fall as the other rises'
  return (
    <Figure
      index="5.2"
      title={title}
      caption="One dot per day. The line follows the median of the y metric across bins of the x metric."
      reading={`ρ = ${formatRho(rho)}, ${formatQ(cell?.q ?? null)}, n = ${cell?.n ?? points.length} days: ${verdict}.`}
      legend={
        <Legend
          items={[
            { label: 'Day', color: DOT, kind: 'dot' },
            { label: 'Binned median', color: TREND, kind: 'line' },
            ...(rho == null ? [] : [{ label: `ρ ${formatRho(rho)}`, color: rhoColor(rho), kind: 'swatch' as const }]),
          ]}
        />
      }
      method={METHOD.pair}
      fetching={daily.isPlaceholderData}
    >
      <PairScatter points={points} defA={dA} defB={dB} />
    </Figure>
  )
}

function StateFigure({ range, registry, marked, onPick }: { range: Range; registry: Registry; marked: string[]; onPick: (k: string) => void }) {
  const state = useStateMatrix(range)
  const grid = useMemo(() => (state.data ? stateGrid(state.data) : null), [state.data])
  const raw = useDaily(grid ? range : null, grid?.metrics)
  const reading = useMemo(() => {
    if (!grid) return null
    let bestDay = -1
    let bestScore = 0
    let bestCount = 0
    for (let c = 0; c < grid.cols; c++) {
      let s = 0
      let n = 0
      for (let r = 0; r < grid.rows; r++) {
        const v = grid.z[r * grid.cols + c]
        if (Number.isNaN(v)) continue
        s += Math.abs(v)
        n++
      }
      if (n >= grid.rows / 2 && s / n > bestScore) {
        bestScore = s / n
        bestDay = c
        bestCount = n
      }
    }
    const vol = grid.extreme.reduce((b, v, i) => (v > grid.extreme[b] ? i : b), 0)
    const parts = []
    if (bestDay >= 0) parts.push(`The most unusual day was ${formatDate(grid.days[bestDay], { weekday: true, year: true })}, with a mean |z| of ${bestScore.toFixed(1)} across ${bestCount} metrics`)
    parts.push(`${def(registry, grid.metrics[vol]).label} is the most volatile, beyond ±2 on ${Math.round(grid.extreme[vol] * 100)}% of its days`)
    return `${parts.join('. ')}.`
  }, [grid, registry])

  if (state.isPending) return <FigureSkeleton height={330} />
  if (!grid || grid.cols === 0 || grid.rows === 0) return <Unavailable index="5.3" title="Daily state" reason="No days with metrics in this range." />
  return (
    <Figure
      index="5.3"
      title="Daily state"
      caption="Each row is a metric and each column a day, colored by how far that day sat from the metric’s own median. Click a row to plot it in 5.2."
      reading={reading}
      legend={
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <RampLegend
            ramp={ramps.diverging}
            label="Robust z"
            ticks={[
              { at: 0, label: `−${Z_CLAMP}` },
              { at: 0.5, label: '0' },
              { at: 1, label: `+${Z_CLAMP}` },
            ]}
          />
          <Legend items={[{ label: 'No data', color: SIGNAL.unworn, kind: 'swatch' }]} />
        </div>
      }
      method={METHOD.state}
      fetching={state.isPlaceholderData}
    >
      <StateRaster grid={grid} raw={raw.data} registry={registry} marked={marked} onPick={onPick} />
    </Figure>
  )
}

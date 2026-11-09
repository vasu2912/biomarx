import { useMemo, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { ChapterPage } from '@/app/ChapterPage'
import { SIGNAL, withAlpha } from '@/core/color'
import { fixed } from '@/core/format'
import { mean, median } from '@/core/stats'
import { useEcg, useEcgList } from '@/infra/queries'
import { Figure, FigureSkeleton, Legend, type LegendItem, type MethodNote } from '@/ui/charts/Figure'
import { EmptyState, cn } from '@/ui/primitives'
import { EnsembleBeat, Poincare, Tachogram } from './charts'
import { ELLIPSE_COLOR, PEAK_COLOR, recordedLabel, RR_COLOR, toModel, toUv, TRACE_COLOR, type EcgModel } from './model'
import { RecordingList } from './RecordingList'
import { TraceStrips } from './Trace'

interface DetailFigure {
  index: string
  title: string
  caption: string
  wide: boolean
  height: number
  legend?: LegendItem[]
  method: MethodNote
  reading: (m: EcgModel) => ReactNode
  render: (m: EcgModel) => ReactNode
  /** reason the figure cannot be drawn, or null */
  missing: (m: EcgModel) => string | null
}

const FILTER = 'The raw signal is band-pass filtered at 0.5–40 Hz (2nd-order Butterworth, zero phase). R peaks are local maxima at least 330 ms apart with prominence above 45% of the 99th percentile.'

const DETAIL: readonly DetailFigure[] = [
  {
    index: '7.2',
    title: 'The recording',
    caption: 'Thirty seconds in three 10-second strips on ECG paper: small squares are 40 ms by 0.1 mV, large ones 200 ms by 0.5 mV. Values on the left are mV.',
    wide: true,
    height: 420,
    legend: [
      { label: 'Filtered trace', color: TRACE_COLOR, kind: 'line' },
      { label: 'Detected R peak', color: PEAK_COLOR, kind: 'dot' },
    ],
    method: { body: FILTER },
    reading: (m) => {
      const amp = median(m.peaks.map((p) => m.trace[p]).filter((v) => !Number.isNaN(v)))
      return (
        <>
          Recorded {recordedLabel(m.summary.recorded_at)}. <b className="num">{m.peaks.length} R peaks</b> in {fixed(m.summary.duration_s)} s, with a median R amplitude of {fixed(amp == null ? null : toUv(amp))} µV.
        </>
      )
    },
    render: (m) => <TraceStrips model={m} />,
    missing: (m) => (m.trace.length ? null : 'This recording has no samples.'),
  },
  {
    index: '7.3',
    title: 'RR tachogram',
    caption: 'The interval between consecutive R peaks, beat by beat. Breathing shows up as a slow wave.',
    wide: true,
    height: 220,
    method: { body: `${FILTER} RR is the time between consecutive peaks.` },
    reading: (m) => (
      <>
        Mean RR is <b className="num">{fixed(mean(m.rri))} ms</b>, ranging {fixed(Math.min(...m.rri))} to {fixed(Math.max(...m.rri))} ms, with RMSSD{' '}
        {fixed(m.summary.rmssd, 1)} ms.
      </>
    ),
    render: (m) => <Tachogram model={m} />,
    missing: (m) => (m.rri.length >= 2 ? null : 'Too few R peaks to form intervals.'),
  },
  {
    index: '7.4',
    title: 'Poincaré plot',
    caption: 'Each RR interval against the next. Spread across the identity line is beat-to-beat variability (SD1), along it the slower drift (SD2).',
    wide: false,
    height: 420,
    legend: [
      { label: 'RR pair', color: RR_COLOR, kind: 'dot' },
      { label: 'SD1 / SD2 ellipse', color: ELLIPSE_COLOR, kind: 'line' },
    ],
    method: {
      body: 'SD1 is the standard deviation of successive RR differences divided by √2. SD2 is √(2·SDNN² − SD1²). The ellipse is centered on the mean RR with SD2 along the identity line and SD1 across it.',
      cite: 'Brennan, Palaniswami and Kamen, IEEE Trans Biomed Eng 2001.',
    },
    reading: (m) => (
      <>
        SD1 is <b className="num">{fixed(m.sd1, 1)} ms</b> and SD2 <b className="num">{fixed(m.sd2, 1)} ms</b>
        {m.sd1 != null && m.sd2 ? <>, a ratio of {fixed(m.sd1 / m.sd2, 2)}</> : null}.
      </>
    ),
    render: (m) => <Poincare model={m} />,
    missing: (m) => (m.rri.length >= 3 ? null : 'Too few RR intervals for a Poincaré plot.'),
  },
  {
    index: '7.5',
    title: 'Ensemble beat',
    caption: 'Every detected beat aligned on its R peak, drawn faint, with the median beat on top.',
    wide: false,
    height: 320,
    legend: [
      { label: 'Single beat', color: withAlpha(SIGNAL.ink, 0.35), kind: 'line' },
      { label: 'Median beat', color: TRACE_COLOR, kind: 'line' },
    ],
    method: { body: `${FILTER} Each beat is cut from 250 ms before to 450 ms after its peak. At most about 40 beats are drawn; the median uses all of them.` },
    reading: (m) => {
      const peak = Math.max(...m.beatMedian.filter((v) => !Number.isNaN(v)))
      return (
        <>
          {m.beats.length} beats overlaid; the median beat peaks at <b className="num">{fixed(toUv(peak))} µV</b>.
        </>
      )
    },
    render: (m) => <EnsembleBeat model={m} />,
    missing: (m) => (m.beats.length && m.beatMs.length ? null : 'No complete beats to align.'),
  },
]

/** Keeps the last loaded recording on screen while the next one loads, instead of flashing skeletons. */
export default function Page() {
  const [params, setParams] = useSearchParams()
  const list = useEcgList()
  const items = useMemo(() => [...(list.data ?? [])].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at)), [list.data])
  const asked = params.get('ecg')
  const selected = items.find((r) => r.id === asked)?.id ?? items[0]?.id ?? null
  const detail = useEcg(selected)
  const shown = detail.data
  const model = useMemo(() => (shown ? toModel(shown) : null), [shown])
  const fetching = model != null && model.summary.id !== selected

  const select = (id: string) =>
    setParams(
      (p) => {
        const out = new URLSearchParams(p)
        out.set('ecg', id)
        return out
      },
      { replace: true },
    )

  const first = items[items.length - 1]
  const last = items[0]

  return (
    <ChapterPage
      lede={
        <p>
          Thirty-second single-lead recordings from the watch, read the way a cardiologist reads a strip: the waveform, the rhythm of its beats, and the
          shape of one typical beat. This chapter ignores the date range.
        </p>
      }
    >
      {list.isLoading ? (
        <FigureSkeleton height={360} />
      ) : (
        <Figure
          index="7.1"
          title="Recordings"
          caption="Every ECG in the export, newest first. Pick one with the pointer or the arrow keys; the figures below follow."
          reading={
            last && first ? (
              <>
                <b className="num">{items.length}</b> recordings from {recordedLabel(first.recorded_at, false)} to {recordedLabel(last.recorded_at, false)}, mean HR{' '}
                {fixed(median(items.map((r) => r.mean_hr)), 1)} bpm at the median.
              </>
            ) : undefined
          }
        >
          {items.length && selected ? (
            <RecordingList items={items} value={selected} onChange={select} />
          ) : (
            <EmptyState title="No ECG recordings">The export holds no ECG files. Record one on the watch and re-import.</EmptyState>
          )}
        </Figure>
      )}
      {selected && (
        <div className="grid gap-x-12 gap-y-20 lg:grid-cols-2">
          {DETAIL.map((f) => {
            const wide = cn(f.wide && 'lg:col-span-2')
            if (!model) {
              return detail.isError ? null : (
                <div key={f.index} className={wide}>
                  <FigureSkeleton height={f.height} />
                </div>
              )
            }
            const missing = f.missing(model)
            return (
              <Figure
                key={f.index}
                className={wide}
                index={f.index}
                title={f.title}
                caption={f.caption}
                reading={missing ? undefined : f.reading(model)}
                legend={f.legend && !missing ? <Legend items={f.legend} /> : undefined}
                method={f.method}
                fetching={fetching}
              >
                {missing ? <EmptyState title="Nothing to draw">{missing}</EmptyState> : f.render(model)}
              </Figure>
            )
          })}
          {detail.isError && <EmptyState title="This recording could not be loaded">Pick another recording, or re-import the export.</EmptyState>}
        </div>
      )}
    </ChapterPage>
  )
}

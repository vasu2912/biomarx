import { Brush } from '@visx/brush'
import { scaleLinear } from 'd3-scale'
import { useCallback, useMemo } from 'react'
import { buildLut, ramps, SIGNAL } from '@/core/color'
import { K } from '@/core/metrics'
import { PRESETS, type PresetKey } from '@/core/range'
import { addDays, daysBetween, formatRange, monthStarts } from '@/core/time'
import { useDaily } from '@/infra/queries'
import { useWidth } from '@/ui/charts/axes'
import { paintLut, RasterCanvas } from '@/ui/charts/RasterCanvas'
import { Segmented, Tooltip } from '@/ui/primitives'
import { useObservatory } from './context'
import { useUi } from './store'

const BARCODE_METRICS = [K.tst, K.wear] as const
const LUT = buildLut(ramps.indigo, 64)
const H = 34

/**
 * Presets plus a full-history barcode (one column per day, brightness = total sleep) with a brush
 * for a custom range. The selection lives in the UI store and is mirrored to the URL by the shell.
 */
export function RangeControl() {
  const { span, range } = useObservatory()
  const selection = useUi((s) => s.selection)
  const setSelection = useUi((s) => s.setSelection)
  const daily = useDaily(span, BARCODE_METRICS)
  const n = daysBetween(span.start, span.end)

  const values = useMemo(() => {
    const out = new Float32Array(n).fill(NaN)
    const d = daily.data
    if (!d) return out
    const tst = d.columns[K.tst] ?? []
    const wear = d.columns[K.wear] ?? []
    d.days.forEach((day, i) => {
      const k = daysBetween(span.start, day)
      if (k < 0 || k >= n) return
      const t = tst[i]
      out[k] = t != null ? t : (wear[i] ?? 0) > 60 ? -1 : NaN
    })
    return out
  }, [daily.data, n, span.start])

  const paint = useMemo(
    () =>
      paintLut(
        values,
        LUT.bytes,
        (v) => (Number.isNaN(v) ? -1 : v < 0 ? 4 : Math.max(8, Math.min(63, Math.round(((v - 3) / 6) * 55 + 8)))),
        [15, 19, 24, 255],
      ),
    [values],
  )

  const preset = selection.kind === 'preset' ? selection.preset : null

  return (
    <div className="flex min-w-0 flex-1 items-center gap-4">
      <Segmented<PresetKey>
        label="Range preset"
        value={preset}
        onChange={(p) => setSelection({ kind: 'preset', preset: p })}
        options={PRESETS.map((p) => ({ value: p.key, label: p.label }))}
      />
      <div className="relative hidden min-w-0 flex-1 md:block" style={{ maxWidth: 560 }}>
        <RasterCanvas
          rows={1}
          cols={n}
          paint={paint}
          height={H}
          margin={{ top: 4, right: 0, bottom: 12, left: 0 }}
          label="Full history, one column per day, brightness is total sleep"
          overlay={(g) => (
            <g>
              {monthStarts(Array.from({ length: n }, (_, i) => addDays(span.start, i)))
                .filter((m) => m.label.includes(' '))
                .map((m) => (
                  <g key={m.index}>
                    <line x1={g.x(m.index)} x2={g.x(m.index)} y1={g.innerH} y2={g.innerH + 3} stroke={SIGNAL.ink4} />
                    <text x={g.x(m.index) + 2} y={g.innerH + 10} fontSize={8.5} fill={SIGNAL.ink3}>
                      {m.label.split(' ')[1]}
                    </text>
                  </g>
                ))}
            </g>
          )}
        />
        <BrushLayer n={n} spanStart={span.start} rangeStart={range.start} rangeEnd={range.end} onPick={(start, end) => setSelection({ kind: 'custom', start, end })} />
      </div>
      <Tooltip content={`${daysBetween(range.start, range.end)} days selected`}>
        <div className="num shrink-0 text-[11.5px] whitespace-nowrap text-ink-2">{formatRange(range.start, range.end)}</div>
      </Tooltip>
    </div>
  )
}

function BrushLayer({
  n,
  spanStart,
  rangeStart,
  rangeEnd,
  onPick,
}: {
  n: number
  spanStart: string
  rangeStart: string
  rangeEnd: string
  onPick: (start: string, end: string) => void
}) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const x = useMemo(() => scaleLinear().domain([0, n]).range([0, w]), [n, w])
  const y = useMemo(() => scaleLinear().domain([0, 1]).range([18, 0]), [])
  const a = daysBetween(spanStart, rangeStart)
  const b = daysBetween(spanStart, rangeEnd)
  const onEnd = useCallback(
    (bounds: { x0: number; x1: number } | null) => {
      if (!bounds) return
      const s = Math.max(0, Math.round(bounds.x0))
      const e = Math.min(n, Math.round(bounds.x1))
      if (e - s >= 14) onPick(addDays(spanStart, s), addDays(spanStart, e))
    },
    [n, onPick, spanStart],
  )
  return (
    <div ref={ref} className="absolute inset-x-0 top-0" style={{ height: 22 }}>
      {w > 0 && (
        <svg width={w} height={22} className="overflow-visible">
          <rect x={0} y={4} width={x(a)} height={18} fill="rgba(7,9,12,0.62)" pointerEvents="none" />
          <rect x={x(b)} y={4} width={w - x(b)} height={18} fill="rgba(7,9,12,0.62)" pointerEvents="none" />
          <g transform="translate(0,4)">
            <Brush
              key={`${a}-${b}-${w}`}
              xScale={x}
              yScale={y}
              width={w}
              height={18}
              handleSize={8}
              brushDirection="horizontal"
              resizeTriggerAreas={['left', 'right']}
              initialBrushPosition={{ start: { x: x(a) }, end: { x: x(b) } }}
              onBrushEnd={onEnd}
              disableDraggingSelection={false}
              useWindowMoveEvents
              selectedBoxStyle={{ fill: 'rgba(236,234,228,0.04)', stroke: SIGNAL.ink, strokeOpacity: 0.7, strokeWidth: 1 }}
              renderBrushHandle={({ x: hx, height, isBrushActive }) =>
                isBrushActive ? (
                  <g transform={`translate(${hx + 3},0)`}>
                    <rect x={-1} width={3} y={-2} height={height + 4} rx={1.5} fill={SIGNAL.ink} />
                  </g>
                ) : null
              }
            />
          </g>
        </svg>
      )}
    </div>
  )
}

import { useMemo, useState } from 'react'
import { SIGNAL, withAlpha } from '@/core/color'
import { fixed } from '@/core/format'
import { AX, useWidth } from '@/ui/charts/axes'
import { HoverCard } from '@/ui/charts/HoverCard'
import { PEAK_COLOR, toUv, TRACE_COLOR, type EcgModel } from './model'

const STRIP_S = 10
const MINOR_MS = 40
const MINOR_MV = 0.1
const MAJOR_EVERY = 5
const MARGIN = { top: 6, right: 12, bottom: 4, left: 40 }
const GAP = 32

const GRID_MINOR = withAlpha(SIGNAL.awake, 0.07)
const GRID_MAJOR = withAlpha(SIGNAL.awake, 0.17)

/** mV domain snapped to the 0.5 mV major grid, at least 1.5 mV tall so quiet traces keep paper proportions. */
function voltDomain(trace: Float32Array): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const v of trace) {
    if (Number.isNaN(v)) continue
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  if (lo === Infinity) return [-0.5, 1]
  let a = Math.floor((lo - 0.05) / 0.5) * 0.5
  let b = Math.ceil((hi + 0.05) / 0.5) * 0.5
  while (b - a < 1.5) {
    if (-a < b) a -= 0.5
    else b += 0.5
  }
  return [a, b]
}

function stripPath(trace: Float32Array, from: number, to: number, x: (k: number) => number, y: (v: number) => number): string {
  let d = ''
  let pen = false
  for (let i = from; i < to; i++) {
    const v = trace[i]
    if (Number.isNaN(v)) {
      pen = false
      continue
    }
    d += `${pen ? 'L' : 'M'}${x(i - from).toFixed(1)},${y(v).toFixed(1)}`
    pen = true
  }
  return d
}

export function TraceStrips({ model }: { model: EcgModel }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<{ strip: number; i: number; px: number; py: number } | null>(null)
  const { trace, fs, peaks } = model
  const perStrip = Math.round(STRIP_S * fs)
  const strips = Math.max(1, Math.ceil(trace.length / perStrip))
  const [lo, hi] = useMemo(() => voltDomain(trace), [trace])

  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right)
  const pxPerMs = innerW / (STRIP_S * 1000)
  const minorPx = MINOR_MS * pxPerMs
  const rowsMinor = Math.round((hi - lo) / MINOR_MV)
  const stripH = rowsMinor * minorPx
  const height = MARGIN.top + strips * (stripH + GAP) + MARGIN.bottom
  const sx = (k: number) => (k / fs) * 1000 * pxPerMs
  const sy = (v: number) => ((hi - v) / (hi - lo)) * stripH
  const stripTop = (s: number) => s * (stripH + GAP)

  const geometry = useMemo(() => {
    if (innerW <= 0) return null
    const cols = (STRIP_S * 1000) / MINOR_MS
    let minor = ''
    let major = ''
    for (let c = 0; c <= cols; c++) {
      const seg = `M${(c * minorPx).toFixed(1)},0V${stripH.toFixed(1)}`
      if (c % MAJOR_EVERY === 0) major += seg
      else minor += seg
    }
    for (let r = 0; r <= rowsMinor; r++) {
      const seg = `M0,${(r * minorPx).toFixed(1)}H${innerW.toFixed(1)}`
      if ((Math.round(hi / MINOR_MV) - r) % MAJOR_EVERY === 0) major += seg
      else minor += seg
    }
    const paths = Array.from({ length: strips }, (_, s) => stripPath(trace, s * perStrip, Math.min(trace.length, (s + 1) * perStrip), sx, sy))
    return { minor, major, paths }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trace, innerW, stripH, strips, perStrip, lo, hi])

  const majorsMv: number[] = []
  for (let v = Math.ceil(lo / 0.5) * 0.5; v <= hi + 1e-9; v += 0.5) majorsMv.push(Math.round(v * 10) / 10)

  const onMove = (s: number) => (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const i = Math.max(0, Math.min(trace.length - 1, s * perStrip + Math.round((px / pxPerMs / 1000) * fs)))
    setHover({ strip: s, i, px: px + MARGIN.left, py: e.clientY - rect.top + MARGIN.top + stripTop(s) })
  }

  const hv = hover ? trace[hover.i] : NaN

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && geometry && (
        <svg width={width} height={height} role="img" aria-label="ECG trace in three 10-second strips on ECG paper">
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {geometry.paths.map((d, s) => {
              const from = s * perStrip
              const to = from + perStrip
              return (
                <g key={s} transform={`translate(0,${stripTop(s)})`}>
                  <path d={geometry.minor} stroke={GRID_MINOR} strokeWidth={0.6} fill="none" />
                  <path d={geometry.major} stroke={GRID_MAJOR} strokeWidth={0.8} fill="none" />
                  {majorsMv.map((v) => (
                    <text key={v} x={-7} y={sy(v)} dy="0.32em" textAnchor="end" fontSize={AX.font} fill={AX.label}>
                      {v === 0 ? '0' : v.toFixed(1)}
                    </text>
                  ))}
                  {Array.from({ length: STRIP_S + 1 }, (_, k) => (
                    <text key={k} x={sx(k * fs)} y={stripH + 14} textAnchor={k === 0 ? 'start' : k === STRIP_S ? 'end' : 'middle'} fontSize={AX.font} fill={AX.label}>
                      {s * STRIP_S + k} s
                    </text>
                  ))}
                  <path d={d} fill="none" stroke={TRACE_COLOR} strokeWidth={1.25} strokeLinejoin="round" />
                  {peaks
                    .filter((p) => p >= from && p < to && !Number.isNaN(trace[p]))
                    .map((p) => (
                      <circle key={p} cx={sx(p - from)} cy={sy(trace[p])} r={2.75} fill={PEAK_COLOR} stroke="var(--color-surface)" strokeWidth={1.5} />
                    ))}
                  {hover?.strip === s && (
                    <g pointerEvents="none">
                      <line x1={sx(hover.i - from)} x2={sx(hover.i - from)} y1={0} y2={stripH} stroke={AX.rule} />
                      {!Number.isNaN(hv) && <circle cx={sx(hover.i - from)} cy={sy(hv)} r={3.5} fill={TRACE_COLOR} stroke="var(--color-surface)" strokeWidth={2} />}
                    </g>
                  )}
                  <rect width={innerW} height={stripH} fill="transparent" onPointerMove={onMove(s)} onPointerLeave={() => setHover(null)} />
                </g>
              )
            })}
          </g>
        </svg>
      )}
      {hover && (
        <HoverCard
          x={hover.px}
          y={hover.py}
          containerW={width}
          title={`${fixed(hover.i / fs, 3)} s`}
          rows={[{ label: 'µV', value: Number.isNaN(hv) ? '—' : fixed(toUv(hv)), color: TRACE_COLOR }]}
        />
      )}
    </div>
  )
}

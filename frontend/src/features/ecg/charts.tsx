import { scaleLinear } from 'd3-scale'
import { line } from 'd3-shape'
import { useMemo, useState } from 'react'
import { SIGNAL, withAlpha } from '@/core/color'
import { fixed } from '@/core/format'
import { mean } from '@/core/stats'
import { AX, useWidth, ValueAxis } from '@/ui/charts/axes'
import { HoverCard } from '@/ui/charts/HoverCard'
import { ELLIPSE_COLOR, RR_COLOR, toUv, TRACE_COLOR, type EcgModel } from './model'

function XTicks({ ticks, x, y, format }: { ticks: number[]; x: (v: number) => number; y: number; format: (v: number) => string }) {
  return (
    <g aria-hidden>
      {ticks.map((t) => (
        <g key={t} transform={`translate(${x(t)},${y})`}>
          <line y2={5} stroke={AX.rule} />
          <text y={17} textAnchor="middle" fontSize={AX.font} fill={AX.label}>
            {format(t)}
          </text>
        </g>
      ))}
    </g>
  )
}

function AxisTitle({ x, y, children, rotate }: { x: number; y: number; children: string; rotate?: boolean }) {
  return (
    <text transform={`translate(${x},${y})${rotate ? ' rotate(-90)' : ''}`} textAnchor="middle" fontSize={AX.font} fill={AX.labelStrong}>
      {children}
    </text>
  )
}

const pointerIn = (e: React.PointerEvent<Element>) => {
  const r = e.currentTarget.getBoundingClientRect()
  return { px: e.clientX - r.left, py: e.clientY - r.top }
}

const TACHO_M = { top: 10, right: 14, bottom: 40, left: 52 }

export function Tachogram({ model }: { model: EcgModel }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hi, setHi] = useState<number | null>(null)
  const height = 220
  const rr = model.rri
  const innerW = Math.max(0, width - TACHO_M.left - TACHO_M.right)
  const innerH = height - TACHO_M.top - TACHO_M.bottom
  const x = scaleLinear().domain([1, Math.max(2, rr.length)]).range([0, innerW])
  const ext = [Math.min(...rr), Math.max(...rr)]
  const pad = Math.max(20, (ext[1] - ext[0]) * 0.1)
  const y = scaleLinear().domain([ext[0] - pad, ext[1] + pad]).range([innerH, 0]).nice(4)
  const path = line<number>()
    .x((_, i) => x(i + 1))
    .y((v) => y(v))(rr)
  const xt = x.ticks(Math.min(10, rr.length)).filter(Number.isInteger)

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const { px } = pointerIn(e)
    setHi(Math.max(0, Math.min(rr.length - 1, Math.round(x.invert(px)) - 1)))
  }

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="RR interval by beat number">
          <g transform={`translate(${TACHO_M.left},${TACHO_M.top})`}>
            <ValueAxis ticks={y.ticks(4)} y={y} x={0} width={innerW} format={(v) => fixed(v)} />
            <XTicks ticks={xt} x={x} y={innerH} format={(v) => fixed(v)} />
            <AxisTitle x={innerW / 2} y={innerH + 34}>
              Beat number
            </AxisTitle>
            <AxisTitle x={-40} y={innerH / 2} rotate>
              RR interval, ms
            </AxisTitle>
            <path d={path ?? ''} fill="none" stroke={RR_COLOR} strokeWidth={1.75} strokeLinejoin="round" />
            {rr.map((v, i) => (
              <circle key={i} cx={x(i + 1)} cy={y(v)} r={2.5} fill={RR_COLOR} stroke="var(--color-surface)" strokeWidth={1.5} />
            ))}
            {hi != null && (
              <g pointerEvents="none">
                <line x1={x(hi + 1)} x2={x(hi + 1)} y1={0} y2={innerH} stroke={AX.rule} />
                <circle cx={x(hi + 1)} cy={y(rr[hi])} r={4} fill={RR_COLOR} stroke="var(--color-surface)" strokeWidth={2} />
              </g>
            )}
            <rect width={innerW} height={innerH} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHi(null)} />
          </g>
        </svg>
      )}
      {hi != null && (
        <HoverCard
          x={TACHO_M.left + x(hi + 1)}
          y={TACHO_M.top + y(rr[hi])}
          containerW={width}
          title={`Beat ${hi + 1} → ${hi + 2}`}
          rows={[
            { label: 'ms RR', value: fixed(rr[hi]), color: RR_COLOR, kind: 'dot' },
            { label: 'bpm instant', value: fixed(60000 / rr[hi], 1) },
          ]}
        />
      )}
    </div>
  )
}

const POIN_M = { top: 10, right: 14, bottom: 40, left: 52 }

export function Poincare({ model }: { model: EcgModel }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hi, setHi] = useState<number | null>(null)
  const rr = model.rri
  const pairs = useMemo(() => rr.slice(0, -1).map((a, i) => [a, rr[i + 1]] as const), [rr])
  const mu = mean(rr) ?? 0
  const sd1 = model.sd1 ?? 0
  const sd2 = model.sd2 ?? 0
  const size = Math.min(width, 420)
  const inner = Math.max(0, size - POIN_M.left - POIN_M.right)
  const halfEllipse = Math.sqrt((sd1 * sd1 + sd2 * sd2) / 2)
  const lo = Math.min(...rr, mu - halfEllipse)
  const hiV = Math.max(...rr, mu + halfEllipse)
  const pad = Math.max(15, (hiV - lo) * 0.08)
  const s = scaleLinear().domain([lo - pad, hiV + pad]).range([0, inner]).nice(4)
  const sy = scaleLinear().domain(s.domain()).range([inner, 0])
  const [d0, d1] = s.domain()
  const k = inner / (d1 - d0)
  const cx = s(mu)
  const cy = sy(mu)
  const ticks = s.ticks(4)

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const { px, py } = pointerIn(e)
    let best = -1
    let bd = Infinity
    pairs.forEach(([a, b], i) => {
      const dd = (s(a) - px) ** 2 + (sy(b) - py) ** 2
      if (dd < bd) {
        bd = dd
        best = i
      }
    })
    setHi(bd < 30 ** 2 ? best : null)
  }

  return (
    <div ref={ref} className="relative" style={{ height: size }}>
      {size > 0 && (
        <svg width={size} height={size} role="img" aria-label="Poincaré plot of successive RR intervals with SD1 and SD2 ellipse">
          <g transform={`translate(${POIN_M.left},${POIN_M.top})`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={s(t)} x2={s(t)} y1={0} y2={inner} stroke={AX.grid} />
                <line x1={0} x2={inner} y1={sy(t)} y2={sy(t)} stroke={AX.grid} />
                <text x={-8} y={sy(t)} dy="0.32em" textAnchor="end" fontSize={AX.font} fill={AX.label}>
                  {fixed(t)}
                </text>
                <text x={s(t)} y={inner + 17} textAnchor="middle" fontSize={AX.font} fill={AX.label}>
                  {fixed(t)}
                </text>
              </g>
            ))}
            <AxisTitle x={inner / 2} y={inner + 34}>
              RR[n], ms
            </AxisTitle>
            <AxisTitle x={-40} y={inner / 2} rotate>
              RR[n+1], ms
            </AxisTitle>
            <line x1={0} y1={inner} x2={inner} y2={0} stroke={AX.rule} />
            {sd1 > 0 && sd2 > 0 && (
              <g transform={`translate(${cx},${cy}) rotate(-45)`}>
                <ellipse rx={sd2 * k} ry={sd1 * k} fill={withAlpha(ELLIPSE_COLOR, 0.08)} stroke={ELLIPSE_COLOR} strokeWidth={1.25} />
                <line x1={0} x2={sd2 * k} y1={0} y2={0} stroke={ELLIPSE_COLOR} strokeWidth={1.25} />
                <line x1={0} x2={0} y1={0} y2={-sd1 * k} stroke={ELLIPSE_COLOR} strokeWidth={1.25} />
              </g>
            )}
            {pairs.map(([a, b], i) => (
              <circle key={i} cx={s(a)} cy={sy(b)} r={hi === i ? 4.5 : 3} fill={RR_COLOR} fillOpacity={0.85} stroke="var(--color-surface)" strokeWidth={1.5} />
            ))}
            {sd1 > 0 && sd2 > 0 && (
              <g fontSize={AX.font} fill={AX.labelStrong} stroke="var(--color-surface)" strokeWidth={3} paintOrder="stroke">
                <text x={cx + (sd2 * k) * Math.SQRT1_2 + 6} y={cy - (sd2 * k) * Math.SQRT1_2 - 4}>
                  SD2 {fixed(sd2, 1)} ms
                </text>
                <text x={cx - (sd1 * k) * Math.SQRT1_2 - 6} y={cy - (sd1 * k) * Math.SQRT1_2 - 4} textAnchor="end">
                  SD1 {fixed(sd1, 1)} ms
                </text>
              </g>
            )}
            <rect width={inner} height={inner} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHi(null)} />
          </g>
        </svg>
      )}
      {hi != null && (
        <HoverCard
          x={POIN_M.left + s(pairs[hi][0])}
          y={POIN_M.top + sy(pairs[hi][1])}
          containerW={size}
          title={`Beats ${hi + 1}, ${hi + 2}, ${hi + 3}`}
          rows={[
            { label: 'ms RR[n]', value: fixed(pairs[hi][0]), color: RR_COLOR, kind: 'dot' },
            { label: 'ms RR[n+1]', value: fixed(pairs[hi][1]) },
          ]}
        />
      )}
    </div>
  )
}

const BEAT_M = { top: 10, right: 14, bottom: 40, left: 52 }

export function EnsembleBeat({ model }: { model: EcgModel }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hi, setHi] = useState<number | null>(null)
  const height = 320
  const { beatMs, beatMedian, beats } = model
  const innerW = Math.max(0, width - BEAT_M.left - BEAT_M.right)
  const innerH = height - BEAT_M.top - BEAT_M.bottom
  const x = scaleLinear().domain([beatMs[0], beatMs[beatMs.length - 1]]).range([0, innerW])
  const all = beats.flat().filter((v) => !Number.isNaN(v))
  const y = scaleLinear().domain([Math.min(...all), Math.max(...all)]).range([innerH, 0]).nice(4)
  const ln = line<number>()
    .defined((v) => !Number.isNaN(v))
    .x((_, i) => x(beatMs[i]))
    .y((v) => y(v))
  const beatPath = beats.map((b) => ln(b) ?? '').join('')

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const ms = x.invert(pointerIn(e).px)
    let best = 0
    beatMs.forEach((t, i) => Math.abs(t - ms) < Math.abs(beatMs[best] - ms) && (best = i))
    setHi(best)
  }

  const spread = hi != null ? beats.map((b) => b[hi]).filter((v) => !Number.isNaN(v)) : []

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="All beats overlaid with the median beat">
          <g transform={`translate(${BEAT_M.left},${BEAT_M.top})`}>
            <ValueAxis ticks={y.ticks(4)} y={y} x={0} width={innerW} format={(v) => fixed(toUv(v))} />
            <XTicks ticks={x.ticks(6)} x={x} y={innerH} format={(v) => fixed(v)} />
            <line x1={x(0)} x2={x(0)} y1={0} y2={innerH} stroke={AX.rule} />
            <AxisTitle x={innerW / 2} y={innerH + 34}>
              Time from R peak, ms
            </AxisTitle>
            <AxisTitle x={-42} y={innerH / 2} rotate>
              µV
            </AxisTitle>
            <path d={beatPath} fill="none" stroke={withAlpha(SIGNAL.ink, 0.13)} strokeWidth={1} />
            <path d={ln(beatMedian) ?? ''} fill="none" stroke={TRACE_COLOR} strokeWidth={2} strokeLinejoin="round" />
            {hi != null && (
              <g pointerEvents="none">
                <line x1={x(beatMs[hi])} x2={x(beatMs[hi])} y1={0} y2={innerH} stroke={AX.rule} />
                {!Number.isNaN(beatMedian[hi]) && (
                  <circle cx={x(beatMs[hi])} cy={y(beatMedian[hi])} r={3.5} fill={TRACE_COLOR} stroke="var(--color-surface)" strokeWidth={2} />
                )}
              </g>
            )}
            <rect width={innerW} height={innerH} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHi(null)} />
          </g>
        </svg>
      )}
      {hi != null && (
        <HoverCard
          x={BEAT_M.left + x(beatMs[hi])}
          y={BEAT_M.top + y(Number.isNaN(beatMedian[hi]) ? 0 : beatMedian[hi])}
          containerW={width}
          title={`${fixed(beatMs[hi], 0)} ms from R`}
          rows={[
            { label: 'µV median', value: fixed(toUv(beatMedian[hi])), color: TRACE_COLOR },
            { label: 'µV range', value: spread.length ? `${fixed(toUv(Math.min(...spread)))} to ${fixed(toUv(Math.max(...spread)))}` : '—', color: withAlpha(SIGNAL.ink, 0.4) },
          ]}
        />
      )}
    </div>
  )
}

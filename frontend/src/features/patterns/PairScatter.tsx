import { scaleLinear, type ScaleLinear } from 'd3-scale'
import { line } from 'd3-shape'
import { useMemo, useState } from 'react'
import { useUi } from '@/app/store'
import { SIGNAL, withAlpha } from '@/core/color'
import type { MetricDef } from '@/core/domain'
import { compact, formatMetric, unitSuffix } from '@/core/format'
import { quantileSorted } from '@/core/stats'
import { clock, formatDate } from '@/core/time'
import { AX, useWidth, ValueAxis } from '@/ui/charts/axes'
import { HoverCard } from '@/ui/charts/HoverCard'
import { binnedMedian, type Pt } from './model'

export const DOT = SIGNAL.hrv
export const TREND = SIGNAL.ink2
const M = { top: 10, right: 24, bottom: 46, left: 66 }
const HEIGHT = 380
const R = 4

function tickFormat(d: MetricDef, s: ScaleLinear<number, number>) {
  if (d.clock) return (v: number) => clock(v)
  if (d.unit === 'h') return (v: number) => `${v}h`
  if (d.unit === 'min') return (v: number) => `${v}m`
  return Math.abs(s.domain()[1]) >= 10_000 ? compact : (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/** 1–99% span so a handful of extreme days cannot squash the cloud; points beyond it pin to the edge. */
function robustDomain(vs: number[]): [number, number] {
  if (!vs.length) return [0, 1]
  const s = [...vs].sort((a, b) => a - b)
  let lo = quantileSorted(s, 0.01)
  let hi = quantileSorted(s, 0.99)
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.05
  lo = s[0] >= 0 ? Math.max(0, lo - pad) : lo - pad
  hi += pad
  return [lo, hi]
}

const axisTitle = (d: MetricDef) => {
  const u = unitSuffix(d)
  return u ? `${d.label} (${u})` : d.label
}

export function PairScatter({ points, defA, defB }: { points: readonly Pt[]; defA: MetricDef; defB: MetricDef }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const hoverDay = useUi((s) => s.hoverDay)
  const setHoverDay = useUi((s) => s.setHoverDay)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const innerW = Math.max(0, width - M.left - M.right)
  const innerH = HEIGHT - M.top - M.bottom

  const { x, y, trend } = useMemo(() => {
    const sx = scaleLinear()
      .domain(robustDomain(points.map((p) => p.x)))
      .range([0, innerW])
      .nice(5)
      .clamp(true)
    const sy = scaleLinear()
      .domain(robustDomain(points.map((p) => p.y)))
      .range([innerH, 0])
      .nice(5)
      .clamp(true)
    const ln = line<{ x: number; y: number }>()
      .x((p) => sx(p.x))
      .y((p) => sy(p.y))
    return { x: sx, y: sy, trend: ln(binnedMedian(points)) ?? '' }
  }, [points, innerW, innerH])

  const hovered = hoverDay ? points.find((p) => p.day === hoverDay) : undefined
  const fx = tickFormat(defA, x)
  const fy = tickFormat(defB, y)

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    let best: Pt | null = null
    let bestD = 18 * 18
    for (const p of points) {
      const d = (x(p.x) - px) ** 2 + (y(p.y) - py) ** 2
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    setPointer(best ? { x: M.left + x(best.x), y: M.top + y(best.y) } : null)
    setHoverDay(best?.day ?? null)
  }

  return (
    <div ref={ref} className="relative" style={{ height: HEIGHT }}>
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label={`Daily ${defB.label} against ${defA.label}`}>
          <g transform={`translate(${M.left},${M.top})`}>
            <ValueAxis ticks={y.ticks(5)} y={y} x={0} width={innerW} format={fy} />
            {x.ticks(5).map((t) => (
              <g key={t} transform={`translate(${x(t)},0)`}>
                <line y1={0} y2={innerH} stroke={AX.grid} />
                <line y1={innerH} y2={innerH + 5} stroke={AX.rule} />
                <text y={innerH + 17} textAnchor="middle" fontSize={AX.font} fill={AX.label}>
                  {fx(t)}
                </text>
              </g>
            ))}
            <text x={innerW / 2} y={innerH + 38} textAnchor="middle" fontSize={AX.font + 1} fill={AX.labelStrong}>
              {axisTitle(defA)} →
            </text>
            <text transform={`translate(${-54},${innerH / 2}) rotate(-90)`} textAnchor="middle" fontSize={AX.font + 1} fill={AX.labelStrong}>
              {axisTitle(defB)} →
            </text>
            <g>
              {points.map((p) => (
                <circle key={p.day} cx={x(p.x)} cy={y(p.y)} r={R} fill={withAlpha(DOT, 0.55)} stroke="var(--color-surface)" strokeWidth={2} />
              ))}
            </g>
            {trend && <path d={trend} fill="none" stroke={TREND} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
            {hovered && <circle cx={x(hovered.x)} cy={y(hovered.y)} r={R + 1.5} fill={DOT} stroke={SIGNAL.ink} strokeWidth={1.5} pointerEvents="none" />}
            <rect
              width={innerW}
              height={innerH}
              fill="transparent"
              onPointerMove={onMove}
              onPointerLeave={() => {
                setPointer(null)
                setHoverDay(null)
              }}
            />
          </g>
        </svg>
      )}
      {pointer && hovered && (
        <HoverCard
          x={pointer.x}
          y={pointer.y}
          containerW={width}
          title={formatDate(hovered.day, { weekday: true, year: true })}
          rows={[
            { label: defA.label, value: `${formatMetric(defA, hovered.x)} ${unitSuffix(defA)}`.trim() },
            { label: defB.label, value: `${formatMetric(defB, hovered.y)} ${unitSuffix(defB)}`.trim() },
          ]}
        />
      )}
    </div>
  )
}

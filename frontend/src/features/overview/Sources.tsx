import { useMemo, useState } from 'react'
import { useUi } from '@/app/store'
import { SIGNAL, withAlpha } from '@/core/color'
import type { Sources } from '@/core/domain'
import { formatDate } from '@/core/time'
import { AX, ChartSurface, DayAxisBottom, type Margin } from '@/ui/charts/axes'
import type { LegendItem } from '@/ui/charts/Figure'
import { HoverCard } from '@/ui/charts/HoverCard'

const PALETTE = [SIGNAL.core, SIGNAL.sun, SIGNAL.rem, SIGNAL.ember, SIGNAL.hrv, SIGNAL.cool, SIGNAL.onset, SIGNAL.resp, SIGNAL.spo2, SIGNAL.awake]
const MARGIN: Margin = { top: 4, right: 18, bottom: 30, left: 80 }
const ROW = 14
const GAP = 8

/** A source keeps its color across ranges: the index is its rank over the whole dataset. */
export const sourceColor = (i: number) => PALETTE[i % PALETTE.length]

export function sourceLegend(d: Sources): LegendItem[] {
  const used = new Set(d.families.flatMap((f) => f.source.filter((s): s is number => s != null)))
  return d.sources.flatMap((name, i) => (used.has(i) ? [{ label: name, color: sourceColor(i) }] : []))
}

/** [start, end, source] runs of equal source, so a year of days draws as a handful of rects. */
function runs(codes: readonly (number | null)[]): [number, number, number][] {
  const out: [number, number, number][] = []
  codes.forEach((c, i) => {
    if (c == null) return
    const last = out[out.length - 1]
    if (last && last[1] === i && last[2] === c) last[1] = i + 1
    else out.push([i, i + 1, c])
  })
  return out
}

export function SourceStrips({ data }: { data: Sources }) {
  const hoverDay = useUi((s) => s.hoverDay)
  const setHoverDay = useUi((s) => s.setHoverDay)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const rows = useMemo(() => data.families.map((f) => ({ ...f, runs: runs(f.source) })), [data])
  const n = data.days.length
  const height = MARGIN.top + rows.length * (ROW + GAP) - GAP + MARGIN.bottom
  const innerH = height - MARGIN.top - MARGIN.bottom
  const hi = hoverDay ? data.days.indexOf(hoverDay) : -1
  return (
    <ChartSurface height={height}>
      {(width) => {
        const innerW = width - MARGIN.left - MARGIN.right
        const x = (i: number) => (i / Math.max(1, n)) * innerW
        const onMove = (e: React.PointerEvent<SVGRectElement>) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const px = e.clientX - rect.left
          setPointer({ x: px + MARGIN.left, y: e.clientY - rect.top + MARGIN.top })
          setHoverDay(data.days[Math.max(0, Math.min(n - 1, Math.floor((px / innerW) * n)))])
        }
        return (
          <>
            <svg width={width} height={height} role="img" aria-label="Source of each record family per day" className="overflow-visible">
              <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
                {rows.map((f, r) => (
                  <g key={f.key} transform={`translate(0,${r * (ROW + GAP)})`}>
                    <text x={-12} y={ROW / 2} dy="0.32em" textAnchor="end" fontSize={11.5} fill={AX.labelStrong}>
                      {f.label}
                    </text>
                    <rect width={innerW} height={ROW} rx={2} fill={withAlpha(SIGNAL.ink, 0.022)} />
                    {f.runs.map(([a, b, c]) => (
                      <rect key={a} x={x(a)} width={Math.max(1, x(b) - x(a))} height={ROW} fill={sourceColor(c)} fillOpacity={0.85} />
                    ))}
                  </g>
                ))}
                <DayAxisBottom days={data.days} x={x} y={innerH + 4} />
                {hi >= 0 && <line x1={x(hi + 0.5)} x2={x(hi + 0.5)} y1={-2} y2={innerH + 2} stroke={SIGNAL.ink} strokeOpacity={0.7} pointerEvents="none" />}
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
            {pointer && hi >= 0 && (
              <HoverCard
                x={pointer.x}
                y={pointer.y}
                containerW={width}
                title={formatDate(data.days[hi], { weekday: true, year: true })}
                rows={data.families.map((f) => {
                  const s = f.source[hi]
                  return s == null ? { label: f.label, value: '—' } : { label: f.label, value: data.sources[s], color: sourceColor(s), kind: 'swatch' }
                })}
              />
            )}
          </>
        )
      }}
    </ChartSurface>
  )
}

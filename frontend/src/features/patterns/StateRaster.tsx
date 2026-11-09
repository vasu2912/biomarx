import { useMemo, useState } from 'react'
import { useUi } from '@/app/store'
import { buildLut, ramps, SIGNAL } from '@/core/color'
import type { Daily } from '@/core/domain'
import { formatMetric, unitSuffix } from '@/core/format'
import { def, type Registry } from '@/core/metrics'
import { formatDate } from '@/core/time'
import { AX, DayAxisBottom, useWidth } from '@/ui/charts/axes'
import { HoverCard } from '@/ui/charts/HoverCard'
import { paintLut, RasterCanvas } from '@/ui/charts/RasterCanvas'
import { shortLabel } from './CorrelationMatrix'
import { Z_CLAMP, type StateGrid } from './model'

const LUT = buildLut(ramps.diverging)
const EMPTY: [number, number, number, number] = [15, 19, 24, 255]
const ROW_H = 15
const MARGIN = { top: 2, right: 4, bottom: 26, left: 146 }

const zIndex = (v: number) => (Number.isNaN(v) ? -1 : Math.round(((Math.max(-Z_CLAMP, Math.min(Z_CLAMP, v)) + Z_CLAMP) / (2 * Z_CLAMP)) * (LUT.size - 1)))

export function StateRaster({
  grid,
  raw,
  registry,
  marked,
  onPick,
}: {
  grid: StateGrid
  raw: Daily | undefined
  registry: Registry
  marked: readonly string[]
  onPick: (key: string) => void
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null)
  const hoverDay = useUi((s) => s.hoverDay)
  const setHoverDay = useUi((s) => s.setHoverDay)
  const paint = useMemo(() => paintLut(grid.z, LUT.bytes, zIndex, EMPTY), [grid])
  const rawIndex = useMemo(() => new Map(raw?.days.map((d, i) => [d, i]) ?? []), [raw])
  const height = MARGIN.top + grid.rows * ROW_H + MARGIN.bottom
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right)
  const hoverCol = hoverDay ? grid.days.indexOf(hoverDay) : -1

  const card = (() => {
    if (!hover) return null
    const key = grid.metrics[hover.row]
    const day = grid.days[hover.col]
    const d = def(registry, key)
    const z = grid.z[hover.row * grid.cols + hover.col]
    const ri = rawIndex.get(day)
    const v = ri == null ? null : raw?.columns[key]?.[ri]
    return (
      <HoverCard
        x={MARGIN.left + ((hover.col + 0.5) / grid.cols) * innerW}
        y={MARGIN.top + hover.row * ROW_H + ROW_H}
        containerW={width}
        title={formatDate(day, { weekday: true, year: true })}
        rows={[
          { label: 'robust z', value: Number.isNaN(z) ? 'no data' : `${z > 0 ? '+' : z < 0 ? '−' : ''}${Math.abs(z).toFixed(2)}`, color: Number.isNaN(z) ? undefined : ramps.diverging(zIndex(z) / (LUT.size - 1)), kind: 'swatch' },
          { label: d.label, value: `${formatMetric(d, v)} ${v == null ? '' : unitSuffix(d)}`.trim() },
        ]}
        footer="Click to plot this metric in 5.2"
      />
    )
  })()

  return (
    <div
      ref={ref}
      className="relative cursor-pointer"
      onClick={() => hover && onPick(grid.metrics[hover.row])}
    >
      <RasterCanvas
        rows={grid.rows}
        cols={grid.cols}
        paint={paint}
        height={height}
        margin={MARGIN}
        label="Daily robust z-score of each metric"
        onHover={(c) => {
          setHover(c)
          setHoverDay(c ? grid.days[c.col] : null)
        }}
        overlay={(g) => (
          <>
            {grid.metrics.map((key, r) => {
              const on = marked.includes(key) || hover?.row === r
              return (
                <g key={key} transform={`translate(0,${g.y(r) + g.rowH / 2})`}>
                  {marked.includes(key) && <rect x={-5} y={-4} width={2} height={8} rx={1} fill={SIGNAL.ink} />}
                  <text x={-10} dy="0.32em" textAnchor="end" fontSize={AX.font + 0.5} fill={on ? SIGNAL.ink : AX.label}>
                    {shortLabel(registry, key)}
                  </text>
                </g>
              )
            })}
            {hoverCol >= 0 && <rect x={g.x(hoverCol)} width={Math.max(1, g.x(1))} y={0} height={g.innerH} fill="none" stroke={SIGNAL.ink} strokeOpacity={0.7} />}
            {hover && <rect x={0} y={g.y(hover.row)} width={g.innerW} height={g.rowH} fill="none" stroke={SIGNAL.ink2} strokeOpacity={0.5} />}
            <DayAxisBottom days={grid.days} x={g.x} y={g.innerH + 4} />
          </>
        )}
      />
      {card}
    </div>
  )
}

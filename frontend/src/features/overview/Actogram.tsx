import { useMemo, useState } from 'react'
import { useUi } from '@/app/store'
import { categoricalLut, SIGNAL, STAGE_CODE } from '@/core/color'
import type { Raster } from '@/core/domain'
import { addDays, clock, dayRange, formatDate } from '@/core/time'
import { DayAxisLeft, HourAxis, type Margin } from '@/ui/charts/axes'
import type { LegendItem } from '@/ui/charts/Figure'
import { HoverCard } from '@/ui/charts/HoverCard'
import { paintLut, RasterCanvas } from '@/ui/charts/RasterCanvas'

/** Indexed by raster code, so the LUT index is the code itself. */
const CODES = [
  { code: STAGE_CODE.unworn, label: 'Not worn', color: SIGNAL.unworn },
  { code: STAGE_CODE.worn, label: 'Awake, worn', color: SIGNAL.worn },
  { code: STAGE_CODE.awake, label: 'Awake in bed', color: SIGNAL.awake },
  { code: STAGE_CODE.core, label: 'Core', color: SIGNAL.core },
  { code: STAGE_CODE.rem, label: 'REM', color: SIGNAL.rem },
  { code: STAGE_CODE.deep, label: 'Deep', color: SIGNAL.deep },
] as const

const LUT = categoricalLut(CODES.map((c) => c.color))
const MAX_CODE = CODES.length - 1
const MARGIN: Margin = { top: 6, right: 18, bottom: 34, left: 56 }

export const ACTOGRAM_LEGEND: LegendItem[] = [...CODES].reverse().map((c) => ({ label: c.label, color: c.color }))

export function Actogram({ raster }: { raster: Raster<Uint8Array> }) {
  const { rows, cols, data, start } = raster
  const days = useMemo(() => dayRange(start, addDays(start, rows)), [start, rows])
  const paint = useMemo(() => paintLut(data, LUT.bytes, (v) => (v <= MAX_CODE ? v : -1), [0, 0, 0, 0]), [data])
  const [cell, setCell] = useState<{ row: number; col: number } | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number; w: number } | null>(null)
  const hoverDay = useUi((s) => s.hoverDay)
  const setHoverDay = useUi((s) => s.setHoverDay)
  const sharedRow = hoverDay ? days.indexOf(hoverDay) : -1

  const height = (innerW: number) => Math.round(Math.max(240, Math.min(560, rows * 1.5, innerW * 0.6))) + MARGIN.top + MARGIN.bottom

  const code = cell ? data[cell.row * cols + cell.col] : null
  const stage = code != null ? CODES[code] : undefined

  return (
    <div
      className="relative"
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        setPointer({ x: e.clientX - r.left, y: e.clientY - r.top, w: r.width })
      }}
      onPointerLeave={() => setPointer(null)}
    >
      <RasterCanvas
        rows={rows}
        cols={cols}
        paint={paint}
        height={height}
        margin={MARGIN}
        label="Actogram: one row per day, 24 hours across, colored by sleep stage"
        onHover={(c) => {
          setCell(c)
          setHoverDay(c ? days[c.row] : null)
        }}
        overlay={(g) => (
          <>
            <DayAxisLeft days={days} y={g.y} x={-4} rowH={g.rowH} />
            <HourAxis x={(h) => (h / 24) * g.innerW} from={0} to={24} y={g.innerH + 2} step={2} />
            {sharedRow >= 0 && (
              <rect x={0} width={g.innerW} y={g.y(sharedRow) - 0.5} height={Math.max(1, g.rowH) + 1} fill="none" stroke={SIGNAL.ink} strokeOpacity={0.55} />
            )}
            {cell && <line x1={g.x(cell.col + 0.5)} x2={g.x(cell.col + 0.5)} y1={0} y2={g.innerH} stroke={SIGNAL.ink} strokeOpacity={0.3} />}
          </>
        )}
      />
      {cell && pointer && stage && (
        <HoverCard
          x={pointer.x}
          y={pointer.y}
          containerW={pointer.w}
          title={formatDate(days[cell.row], { weekday: true, year: true })}
          rows={[{ label: stage.label, value: clock(cell.col / 60), color: stage.color, kind: 'swatch' }]}
        />
      )}
    </div>
  )
}

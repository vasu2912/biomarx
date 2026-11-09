import { useMemo, useState } from 'react'
import { useObservatory } from '@/app/context'
import { categoricalLut, SIGNAL } from '@/core/color'
import type { Raster } from '@/core/domain'
import { formatDate } from '@/core/time'
import { useRaster } from '@/infra/queries'
import { AX, DayAxisLeft, HourAxis, useWidth, type Margin } from '@/ui/charts/axes'
import { Figure, Legend } from '@/ui/charts/Figure'
import { HoverCard } from '@/ui/charts/HoverCard'
import { paintLut, RasterCanvas } from '@/ui/charts/RasterCanvas'
import { EmptyState } from '@/ui/primitives'
import { actogramCell, loadable, noonToNoon, STAGE_ROWS, type Actogram as ActogramData } from './data'
import { Frame } from './Frame'

const LUT = categoricalLut(STAGE_ROWS.map((s) => s.color))
const STAGE_BY_CODE = new Map<number, (typeof STAGE_ROWS)[number]>(STAGE_ROWS.map((s) => [s.code, s]))
const MARGIN: Margin = { top: 34, right: 12, bottom: 8, left: 64 }
const MAX_H = 640
const x24 = (innerW: number) => (h: number) => ((h - 12) / 24) * innerW

export function Actogram() {
  const { range } = useObservatory()
  const state = loadable(useRaster('sleep', range))
  return (
    <Frame state={state} height={480}>
      {(raster, fetching) => <ActogramFigure raster={raster} fetching={fetching} />}
    </Frame>
  )
}

function ActogramFigure({ raster, fetching }: { raster: Raster; fetching: boolean }) {
  const acto = useMemo(() => noonToNoon(raster), [raster])
  return (
        <Figure
          index="2.1"
          title="Every night, noon to noon"
          caption="One row per night, read left to right from noon on day D to noon on D + 1. Color is the staged state of each minute."
          reading={
            acto
              ? `Sleep recorded on ${acto.sleptNights} of ${acto.rows} nights. The watch was worn for ${Math.round(acto.wornShare * 100)}% of all minutes.`
              : undefined
          }
          legend={<Legend items={[...STAGE_ROWS].reverse().map((s) => ({ label: s.label, color: s.color }))} />}
          method={{
            body: (
              <>
                <p>Each row is night D. It joins the second half of calendar day D (from noon) with the first half of D + 1, so an episode that crosses midnight is never split.</p>
                <p>Night D is the sleep that starts after noon on D. Minutes come from the source with the most staged minutes that night. Dark cells are minutes with no heart-rate sample within 15 minutes.</p>
              </>
            ),
          }}
          fetching={fetching}
        >
          {acto ? <ActogramChart acto={acto} /> : <EmptyState title="Too few days">The actogram needs at least two days of sleep data in the range.</EmptyState>}
        </Figure>
  )
}

function ActogramChart({ acto }: { acto: ActogramData }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [cell, setCell] = useState<{ row: number; col: number } | null>(null)
  const paint = useMemo(() => paintLut(acto.data, LUT.bytes, (v) => (v < LUT.size ? v : -1), [0, 0, 0, 0]), [acto])
  const rowPx = Math.max(0.35, Math.min(3, MAX_H / acto.rows))
  const height = Math.min(MAX_H, Math.round(acto.rows * rowPx)) + MARGIN.top + MARGIN.bottom
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right)
  const innerH = height - MARGIN.top - MARGIN.bottom

  const hovered = cell ? actogramCell(acto, cell.row, cell.col) : null
  const stage = hovered ? STAGE_BY_CODE.get(hovered.code) : undefined

  return (
    <div ref={ref} className="relative">
      <RasterCanvas
        rows={acto.rows}
        cols={1440}
        paint={paint}
        height={height}
        margin={MARGIN}
        label={`Actogram of ${acto.rows} nights, noon to noon`}
        onHover={setCell}
        overlay={(g) => {
          const x = x24(g.innerW)
          return (
            <>
              <line x1={x(24)} x2={x(24)} y1={0} y2={g.innerH} stroke={AX.rule} strokeOpacity={0.5} />
              <HourAxis x={x} from={12} to={36} y={-6} step={2} orientation="top" />
              <DayAxisLeft days={acto.nights} y={g.y} x={-4} rowH={g.rowH} />
              {cell && (
                <rect x={-2} width={g.innerW + 4} y={g.y(cell.row) - 0.5} height={Math.max(1, g.rowH) + 1} fill="none" stroke={SIGNAL.ink} strokeOpacity={0.55} />
              )}
            </>
          )
        }}
      />
      {cell && hovered && (
        <HoverCard
          x={MARGIN.left + (cell.col / 1440) * innerW}
          y={MARGIN.top + (cell.row / acto.rows) * innerH}
          containerW={width}
          title={formatDate(hovered.date, { weekday: true, year: true })}
          rows={[{ label: stage?.label ?? 'Unknown', value: hovered.time, color: stage?.color, kind: 'swatch' }]}
          footer={`Night of ${formatDate(acto.nights[cell.row], { weekday: true })}`}
        />
      )}
    </div>
  )
}

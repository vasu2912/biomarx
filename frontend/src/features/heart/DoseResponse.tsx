import { line } from 'd3-shape'
import { useMemo, useState } from 'react'
import { buildLut, ramps, SIGNAL } from '@/core/color'
import type { HrActivity } from '@/core/domain'
import { compact, fixed } from '@/core/format'
import { isNum } from '@/core/stats'
import { AX, useWidth } from '@/ui/charts/axes'
import { Figure, FigureSkeleton, Legend, RampLegend } from '@/ui/charts/Figure'
import { HoverCard } from '@/ui/charts/HoverCard'
import { paintLut, RasterCanvas, type RasterGeom } from '@/ui/charts/RasterCanvas'
import { EmptyState } from '@/ui/primitives'

const LUT = buildLut(ramps.ember, 64)
/** the ember ramp starts at the page background; skip its darkest steps so single counts stay visible */
const RAMP_FLOOR = 0.14
const ramp = (t: number) => ramps.ember(RAMP_FLOOR + (1 - RAMP_FLOOR) * t)
const EMPTY: [number, number, number, number] = [13, 16, 21, 255]
const HEIGHT = 380
const MARGIN = { top: 8, right: 16, bottom: 42, left: 56 }

interface DoseModel {
  rows: number
  cols: number
  /** display order: row 0 is the highest HR bin */
  cells: Float32Array
  max: number
  total: number
  xEdges: number[]
  yEdges: number[]
  curve: { steps: number; hr: number }[]
  bins: number
}

type Cell = { row: number; col: number }

function toModel(d: HrActivity['dose_response']): DoseModel {
  const rows = d.counts.length
  const cols = d.counts[0]?.length ?? 0
  const cells = new Float32Array(rows * cols)
  let max = 0
  let total = 0
  d.counts.forEach((row, yb) => {
    row.forEach((c, xb) => {
      const v = c ?? 0
      cells[(rows - 1 - yb) * cols + xb] = v
      max = Math.max(max, v)
      total += v
    })
  })
  const curve = d.median_x.flatMap((s, i) => {
    const hr = d.median_hr[i]
    return isNum(s) && isNum(hr) ? [{ steps: s, hr }] : []
  })
  return { rows, cols, cells, max, total, xEdges: d.x_edges.map((v) => v ?? NaN), yEdges: d.y_edges.map((v) => v ?? NaN), curve, bins: d.bins }
}

function lutIndex(max: number) {
  const lmax = Math.log1p(max) || 1
  const top = LUT.size - 1
  const base = Math.round(RAMP_FLOOR * top)
  return (c: number) => (c > 0 ? base + Math.round((Math.log1p(c) / lmax) * (top - base)) : -1)
}

export function DoseResponseFigure({ data, fetching }: { data: HrActivity | undefined; fetching: boolean }) {
  const dose = data?.dose_response
  const model = useMemo(() => (dose ? toModel(dose) : null), [dose])
  const paint = useMemo(() => (model ? paintLut(model.cells, LUT.bytes, lutIndex(model.max), EMPTY) : null), [model])

  if (!model || !paint) return <FigureSkeleton height={HEIGHT} />

  const lmax = Math.log1p(model.max) || 1
  const rampTicks = [1, 10, 100, 1000, 10000].filter((c) => c <= model.max).map((c) => ({ at: Math.log1p(c) / lmax, label: compact(c) }))
  const first = model.curve[0]
  const last = model.curve[model.curve.length - 1]

  return (
    <Figure
      index="4.5"
      title="Heart rate against movement"
      caption="Every 10-minute bin placed by its step count and mean HR. Brighter cells hold more bins; the line traces median HR as steps rise."
      reading={
        model.total > 0 && first && last && first !== last ? (
          <>
            Over {fixed(model.bins)} bins, median HR climbs from <b className="num">{fixed(first.hr)} bpm</b> at zero steps to{' '}
            <b className="num">{fixed(last.hr)} bpm</b> near {fixed(last.steps)} steps per 10 min.
          </>
        ) : undefined
      }
      legend={
        model.total > 0 ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <RampLegend ramp={ramp} ticks={rampTicks} label="Bins per cell, log" />
            <Legend items={[{ label: 'Median HR', color: SIGNAL.ink, kind: 'line' }]} />
          </div>
        ) : undefined
      }
      method={{
        body: 'Each 10-minute bin with both steps and heart rate adds one count to the cell of its step total and mean HR. Color is log(1 + count). The median curve takes median HR within step bands (0, 1–49, 50–99, 100–199 and so on up to 1,399), drawn at each band center and only where a band holds more than 30 bins.',
      }}
      fetching={fetching}
    >
      {model.total === 0 ? (
        <EmptyState title="No paired step and heart-rate bins">This range has no 10-minute bins with both measures.</EmptyState>
      ) : (
        <DosePlot model={model} paint={paint} />
      )}
    </Figure>
  )
}

function DosePlot({ model, paint }: { model: DoseModel; paint: (img: ImageData) => void }) {
  const [cell, setCell] = useState<Cell | null>(null)
  const [wrapRef, wrapW] = useWidth<HTMLDivElement>()
  const lmax = Math.log1p(model.max) || 1
  const innerW = Math.max(0, wrapW - MARGIN.left - MARGIN.right)
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom
  const count = cell ? model.cells[cell.row * model.cols + cell.col] : 0
  const yb = cell ? model.rows - 1 - cell.row : 0
  return (
        <div ref={wrapRef} className="relative">
          <RasterCanvas
            rows={model.rows}
            cols={model.cols}
            paint={paint}
            height={HEIGHT}
            margin={MARGIN}
            label="Two-dimensional histogram of steps per 10 minutes against heart rate"
            onHover={setCell}
            overlay={(g) => <DoseOverlay g={g} model={model} cell={cell} />}
          />
          {cell && innerW > 0 && (
            <HoverCard
              x={MARGIN.left + ((cell.col + 1) / model.cols) * innerW}
              y={MARGIN.top + (cell.row / model.rows) * innerH}
              containerW={wrapW}
              title={`${fixed(model.xEdges[cell.col])}–${fixed(model.xEdges[cell.col + 1])} steps per 10 min`}
              rows={[
                { label: 'bpm', value: `${fixed(model.yEdges[yb], 1)}–${fixed(model.yEdges[yb + 1], 1)}` },
                { label: count === 1 ? 'bin' : 'bins', value: fixed(count), color: count > 0 ? ramp(Math.log1p(count) / lmax) : SIGNAL.ink4, kind: 'swatch' },
              ]}
            />
          )}
        </div>
  )
}

function DoseOverlay({ g, model, cell }: { g: RasterGeom; model: DoseModel; cell: Cell | null }) {
  const x0 = model.xEdges[0]
  const x1 = model.xEdges[model.xEdges.length - 1]
  const y0 = model.yEdges[0]
  const y1 = model.yEdges[model.yEdges.length - 1]
  const sx = (s: number) => ((s - x0) / (x1 - x0)) * g.innerW
  const sy = (h: number) => g.innerH - ((h - y0) / (y1 - y0)) * g.innerH
  const path =
    line<{ steps: number; hr: number }>()
      .x((p) => sx(p.steps))
      .y((p) => sy(p.hr))(model.curve) ?? ''
  const xt = Array.from({ length: Math.floor((x1 - x0) / 200) + 1 }, (_, i) => x0 + i * 200)
  const yt = Array.from({ length: Math.floor((y1 - y0) / 20) + 1 }, (_, i) => y0 + i * 20)
  return (
    <g>
      {xt.map((t) => (
        <g key={t} transform={`translate(${sx(t)},${g.innerH})`}>
          <line y2={5} stroke={AX.rule} />
          <text y={17} textAnchor="middle" fontSize={AX.font} fill={AX.label}>
            {fixed(t)}
          </text>
        </g>
      ))}
      <text x={g.innerW / 2} y={g.innerH + 34} textAnchor="middle" fontSize={AX.font} fill={AX.labelStrong}>
        Steps per 10 min
      </text>
      {yt.map((t) => (
        <g key={t} transform={`translate(0,${sy(t)})`}>
          <line x1={-5} stroke={AX.rule} />
          <text x={-8} dy="0.32em" textAnchor="end" fontSize={AX.font} fill={AX.label}>
            {t}
          </text>
        </g>
      ))}
      <text transform={`translate(-40,${g.innerH / 2}) rotate(-90)`} textAnchor="middle" fontSize={AX.font} fill={AX.labelStrong}>
        Heart rate, bpm
      </text>
      <path d={path} fill="none" stroke={SIGNAL.bg} strokeWidth={4} strokeLinejoin="round" opacity={0.7} />
      <path d={path} fill="none" stroke={SIGNAL.ink} strokeWidth={1.75} strokeLinejoin="round" />
      {model.curve.map((p) => (
        <circle key={p.steps} cx={sx(p.steps)} cy={sy(p.hr)} r={2.5} fill={SIGNAL.ink} stroke={SIGNAL.bg} strokeWidth={1.5} />
      ))}
      {cell && (
        <rect x={g.x(cell.col)} y={g.y(cell.row)} width={g.innerW / model.cols} height={g.rowH} fill="none" stroke={SIGNAL.ink} strokeWidth={1.25} />
      )}
    </g>
  )
}

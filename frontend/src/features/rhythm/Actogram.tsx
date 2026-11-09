import { useMemo, useState, type ReactNode } from 'react'
import { useObservatory } from '@/app/context'
import { useUi } from '@/app/store'
import { buildLut, SIGNAL, type Ramp } from '@/core/color'
import type { Raster } from '@/core/domain'
import { compact, fixed } from '@/core/format'
import { quantileSorted } from '@/core/stats'
import { addDays, clock, daysBetween, formatDate, type IsoDate } from '@/core/time'
import { useRaster } from '@/infra/queries'
import type { RasterName } from '@/infra/raster'
import { AX, DayAxisLeft, HourAxis } from '@/ui/charts/axes'
import { Figure, FigureSkeleton, RampLegend, type MethodNote } from '@/ui/charts/Figure'
import { HoverCard } from '@/ui/charts/HoverCard'
import { paintLut, RasterCanvas } from '@/ui/charts/RasterCanvas'
import { EmptyState } from '@/ui/primitives'

export interface ActogramSpec {
  index: string
  title: string
  caption: string
  method: MethodNote
  raster: Extract<RasterName, 'hr5' | 'steps10'>
  ramp: Ramp
  /** sqrt compresses the long tail of step counts so ordinary walking stays visible */
  scale: 'linear' | 'sqrt'
  /** hr5 stores 0 for an unworn bin; steps10 stores 0 for a still one */
  zeroIsMissing: boolean
  unit: string
  legendLabel: string
  format: (v: number) => string
  reading: (m: ActogramModel) => ReactNode
}

export interface ActogramModel {
  days: IsoDate[]
  cols: number
  binMin: number
  data: Float32Array
  lo: number
  hi: number
  valid: (v: number) => boolean
  /** mean of valid values per clock hour, 0..23 */
  hourly: (number | null)[]
  daysWithData: number
  paint: (img: ImageData) => void
  color: (v: number) => string
  ramp: Ramp
}

const LUT_SIZE = 256
const MARGIN = { top: 6, right: 14, bottom: 34, left: 54 }
const EMPTY: [number, number, number, number] = [15, 19, 24, 255]

function buildModel(r: Raster<Float32Array>, spec: ActogramSpec): ActogramModel | null {
  const { rows, cols, data } = r
  const valid = (v: number) => Number.isFinite(v) && (!spec.zeroIsMissing || v > 0)
  const vals: number[] = []
  const hourSum = new Array<number>(24).fill(0)
  const hourN = new Array<number>(24).fill(0)
  const perHour = cols / 24
  let daysWithData = 0
  for (let row = 0; row < rows; row++) {
    let any = false
    for (let c = 0; c < cols; c++) {
      const v = data[row * cols + c]
      if (!valid(v)) continue
      any = true
      vals.push(v)
      const h = Math.floor(c / perHour)
      hourSum[h] += v
      hourN[h]++
    }
    if (any) daysWithData++
  }
  if (!vals.length) return null
  vals.sort((a, b) => a - b)
  const lo = spec.scale === 'sqrt' ? 0 : quantileSorted(vals, 0.02)
  const hi = quantileSorted(vals, 0.98)
  const f = spec.scale === 'sqrt' ? Math.sqrt : (v: number) => v
  const f0 = f(lo)
  const span = f(hi) - f0 || 1
  const t = (v: number) => Math.max(0, Math.min(1, (f(v) - f0) / span))
  const lut = buildLut(spec.ramp, LUT_SIZE)
  const days = Array.from({ length: rows }, (_, i) => addDays(r.start, i))
  return {
    days,
    cols,
    binMin: 1440 / cols,
    data,
    lo,
    hi,
    valid,
    hourly: hourSum.map((s, h) => (hourN[h] ? s / hourN[h] : null)),
    daysWithData,
    paint: paintLut(data, lut.bytes, (v) => (valid(v) ? Math.round(t(v) * (LUT_SIZE - 1)) : -1), EMPTY),
    color: (v) => spec.ramp(t(v)),
    ramp: spec.ramp,
  }
}

/** Day rows, clock columns: the double-plotted actogram's single-plotted cousin. */
export function ActogramFigure({ spec }: { spec: ActogramSpec }) {
  const { range } = useObservatory()
  const q = useRaster(spec.raster, range)
  const hoverDay = useUi((s) => s.hoverDay)
  const setHoverDay = useUi((s) => s.setHoverDay)
  const [cell, setCell] = useState<{ row: number; col: number } | null>(null)
  const [ptr, setPtr] = useState<{ x: number; y: number; w: number } | null>(null)

  const model = useMemo(() => (q.data && q.data.data instanceof Float32Array ? buildModel(q.data as Raster<Float32Array>, spec) : null), [q.data, spec])

  if (q.isPending) return <FigureSkeleton height={460} />
  const head = { index: spec.index, title: spec.title, caption: spec.caption, method: spec.method }
  if (q.isError || !model) {
    return (
      <Figure {...head}>
        <EmptyState title="No samples in this range">{q.error?.message ?? 'The watch recorded nothing for these days.'}</EmptyState>
      </Figure>
    )
  }

  const m = model
  const rows = m.days.length
  const innerHeight = Math.max(220, Math.min(520, rows * 1.25))
  const hoverRow = hoverDay ? daysBetween(m.days[0], hoverDay) : -1
  const hv = cell ? m.data[cell.row * m.cols + cell.col] : NaN
  const ticks = spec.scale === 'sqrt' ? [0, 0.25, 0.5, 1].map((s) => ({ at: Math.sqrt(s), v: m.lo + s * (m.hi - m.lo) })) : [0, 0.5, 1].map((s) => ({ at: s, v: m.lo + s * (m.hi - m.lo) }))

  return (
    <Figure
      {...head}
      fetching={q.isPlaceholderData && q.isFetching}
      reading={spec.reading(m)}
      legend={<RampLegend ramp={m.ramp} label={spec.legendLabel} ticks={ticks.map((k) => ({ at: k.at, label: spec.format(k.v) }))} width={200} />}
    >
      <div
        className="relative"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setPtr({ x: e.clientX - r.left, y: e.clientY - r.top, w: r.width })
        }}
        onPointerLeave={() => setPtr(null)}
      >
        <RasterCanvas
          rows={rows}
          cols={m.cols}
          paint={m.paint}
          height={innerHeight + MARGIN.top + MARGIN.bottom}
          margin={MARGIN}
          label={`${spec.title}, ${rows} days by time of day`}
          onHover={(c) => {
            setCell(c)
            setHoverDay(c ? m.days[c.row] : null)
          }}
          overlay={(g) => (
            <>
              <line x1={0} x2={g.innerW} y1={g.innerH} y2={g.innerH} stroke={AX.rule} />
              <HourAxis x={(h) => (h / 24) * g.innerW} from={0} to={24} y={g.innerH + 2} step={3} />
              <DayAxisLeft days={m.days} y={g.y} x={0} rowH={g.rowH} />
              {hoverRow >= 0 && hoverRow < rows && (
                <rect x={0} width={g.innerW} y={g.y(hoverRow)} height={Math.max(1, g.rowH)} fill="none" stroke={SIGNAL.ink2} strokeOpacity={0.6} strokeWidth={1} />
              )}
              {cell && <line x1={g.x(cell.col + 0.5)} x2={g.x(cell.col + 0.5)} y1={0} y2={g.innerH} stroke={AX.rule} />}
            </>
          )}
        />
        {cell && ptr && (
          <HoverCard
            x={ptr.x}
            y={ptr.y}
            containerW={ptr.w}
            title={formatDate(m.days[cell.row], { weekday: true, year: true })}
            rows={[
              {
                label: `${clock((cell.col * m.binMin) / 60)}–${clock(((cell.col + 1) * m.binMin) / 60)}`,
                value: m.valid(hv) ? `${spec.format(hv)} ${spec.unit}` : 'no data',
                color: m.valid(hv) ? m.color(hv) : undefined,
                kind: 'swatch',
              },
            ]}
          />
        )}
      </div>
    </Figure>
  )
}

export const fmtBpm = (v: number) => fixed(v, 0)
export const fmtSteps = (v: number) => (v >= 1000 ? compact(v) : fixed(v, 0))

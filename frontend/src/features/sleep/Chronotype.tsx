import { scaleLinear } from 'd3-scale'
import { useMemo, useState } from 'react'
import { useObservatory } from '@/app/context'
import { SIGNAL } from '@/core/color'
import type { Chronotype as ChronotypeData } from '@/core/domain'
import { fixed } from '@/core/format'
import { isNum, quantile } from '@/core/stats'
import { clock, duration } from '@/core/time'
import { useChronotype } from '@/infra/queries'
import { AX, HourAxis, useWidth } from '@/ui/charts/axes'
import { Figure, Legend } from '@/ui/charts/Figure'
import { HoverCard } from '@/ui/charts/HoverCard'
import { EmptyState } from '@/ui/primitives'
import { eveningClock, loadable, occupiedWindow, rotateHistogram, type ClockHistogram } from './data'
import { Frame, PanelLabel } from './Frame'

const HISTS = [
  { key: 'onset', label: 'Sleep onset', color: SIGNAL.onset },
  { key: 'mid', label: 'Mid-sleep', color: SIGNAL.mid },
  { key: 'wake', label: 'Wake', color: SIGNAL.wake },
] as const

const DAY_KIND = {
  work: { label: 'Work-day nights', color: SIGNAL.mid },
  free: { label: 'Free-day nights', color: SIGNAL.wake },
} as const

interface WeekdayRow {
  label: string
  free: boolean
  values: number[]
  median: number | null
}

interface ChronoView {
  binH: number
  hists: ClockHistogram[]
  window: [number, number]
  weekday: WeekdayRow[]
  weekdayDomain: [number, number]
  tiles: { label: string; value: string; note: string }[]
  nights: number
}

function toView(c: ChronotypeData): ChronoView | null {
  const hists = HISTS.map((h): ClockHistogram => {
    const raw = c.histograms[h.key] ?? []
    const r = rotateHistogram(raw)
    const circ = c.circular[h.key]
    return { key: h.key, ...r, meanHour: eveningClock(circ?.hour ?? null), r: circ?.r ?? null }
  })
  const nights = hists[0].counts.reduce((a, b) => a + b, 0)
  if (!nights) return null
  const binH = 24 / (hists[0].counts.length || 96)
  const weekday = c.weekday.map((w) => ({
    label: w.label,
    free: w.free,
    values: w.values.map(eveningClock).filter(isNum),
    median: eveningClock(w.median ?? null),
  }))
  const all = weekday.flatMap((w) => w.values)
  const lo = quantile(all, 0.01) ?? 24
  const hi = quantile(all, 0.99) ?? 32
  const jet = c.social_jetlag_min
  return {
    binH,
    hists,
    window: occupiedWindow(hists, binH),
    weekday,
    weekdayDomain: [Math.floor(lo), Math.ceil(hi)],
    nights,
    tiles: [
      { label: 'Mid-sleep, work days', value: clock(c.msw), note: 'MSW' },
      { label: 'Mid-sleep, free days', value: clock(c.msf), note: 'MSF' },
      { label: 'Corrected for oversleep', value: clock(c.msfsc), note: 'MSFsc' },
      { label: 'Social jet lag', value: isNum(jet) ? duration(jet) : '—', note: '|MSF − MSW|' },
    ],
  }
}

export function Chronotype() {
  const { range } = useObservatory()
  const state = loadable(useChronotype(range))
  return <Frame state={state} height={420}>{(c, fetching) => <ChronotypeFigure data={c} fetching={fetching} />}</Frame>
}

function ChronotypeFigure({ data, fetching }: { data: ChronotypeData; fetching: boolean }) {
  const v = useMemo(() => toView(data), [data])
  return (
    <Figure
      index="2.6"
      title="Chronotype, and the cost of the work week"
      caption="Where onset, mid-sleep and wake fall on the clock, with each circular mean marked. Below, mid-sleep by the weekday the night starts on."
      reading={
        v
          ? `Mid-sleep sits at ${clock(data.msw)} before work days and ${clock(data.msf)} before free days, a social jet lag of ${duration(data.social_jetlag_min)} over ${v.nights} nights.`
          : undefined
      }
      method={{
        body: (
          <>
            <p>Histograms count nights in 15-minute bins of local clock time. The marked mean is circular, so 23:50 and 00:10 average to midnight; R near 1 means tightly clustered.</p>
            <p>MSW and MSF are the mid-sleep of nights before work and free days. MSFsc corrects MSF for oversleep on free days: when free-day sleep is longer, it subtracts half the difference between mean free-day and mean work-day sleep duration. Free days are Friday and Saturday nights. Social jet lag is the absolute difference between MSF and MSW.</p>
          </>
        ),
        cite: 'Roenneberg T et al. Life between clocks: daily temporal patterns of human chronotypes. J Biol Rhythms 2003.',
      }}
      fetching={fetching}
    >
      {v ? (
        <div className="space-y-12">
          <Tiles tiles={v.tiles} />
          <div className="grid gap-x-10 gap-y-12 lg:grid-cols-2">
            <div className="min-w-0">
              <PanelLabel title="Clock time distribution" value={`${v.nights} nights`} />
              <Histograms v={v} />
            </div>
            <div className="min-w-0">
              <PanelLabel title="Mid-sleep by weekday" />
              <Legend
                className="mb-2"
                items={[
                  { label: DAY_KIND.work.label, color: DAY_KIND.work.color, kind: 'dot' },
                  { label: `${DAY_KIND.free.label} (rings)`, color: DAY_KIND.free.color, kind: 'dot' },
                  { label: 'Median', color: SIGNAL.ink, kind: 'line' },
                ]}
              />
              <WeekdayDots v={v} />
            </div>
          </div>
        </div>
      ) : (
        <EmptyState title="No nights to place">No main sleep episode falls inside the range.</EmptyState>
      )}
    </Figure>
  )
}

function Tiles({ tiles }: { tiles: ChronoView['tiles'] }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-hairline bg-hairline lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.note} className="bg-surface px-4 py-3.5">
          <dt className="text-[12px] text-ink-3">{t.label}</dt>
          <dd className="mt-1 flex items-baseline gap-2">
            <span className="text-[26px] font-semibold text-ink">{t.value}</span>
            <span className="num text-[11px] text-ink-3">{t.note}</span>
          </dd>
        </div>
      ))}
    </dl>
  )
}

const H_M = { top: 4, right: 22, bottom: 30, left: 100 }
const ROW_H = 64
const ROW_GAP = 10

function Histograms({ v }: { v: ChronoView }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hour, setHour] = useState<{ h: number; px: number; py: number } | null>(null)
  const height = H_M.top + HISTS.length * (ROW_H + ROW_GAP) + H_M.bottom
  const innerW = Math.max(0, width - H_M.left - H_M.right)
  const [from, to] = v.window
  const x = scaleLinear().domain([from, to]).range([0, innerW])
  const max = Math.max(...v.hists.flatMap((h) => h.counts), 1)
  const bw = Math.max(1, x(from + v.binH) - x(from) - 1)
  const bin = hour ? Math.floor((hour.h - 12) / v.binH) : -1
  const axisY = H_M.top + HISTS.length * (ROW_H + ROW_GAP) - ROW_GAP

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Clock time histograms of onset, mid-sleep and wake">
          <g transform={`translate(${H_M.left},0)`}>
            {v.hists.map((h, k) => {
              const meta = HISTS[k]
              const top = H_M.top + k * (ROW_H + ROW_GAP)
              const y = (c: number) => top + ROW_H - (c / max) * ROW_H
              return (
                <g key={h.key}>
                  <line x1={0} x2={innerW} y1={top + ROW_H} y2={top + ROW_H} stroke={AX.rule} />
                  <text x={-10} y={top + ROW_H - 18} textAnchor="end" fontSize={11} fill={AX.labelStrong}>
                    {meta.label}
                  </text>
                  <text x={-10} y={top + ROW_H - 4} textAnchor="end" fontSize={AX.font} fill={AX.label} className="num">
                    mean {clock(h.meanHour)}
                  </text>
                  {h.counts.map((c, j) => {
                    const hh = h.hours[j]
                    if (c <= 0 || hh < from || hh >= to) return null
                    return <rect key={j} x={x(hh) + 0.5} width={bw} y={y(c)} height={top + ROW_H - y(c)} rx={1} fill={meta.color} fillOpacity={j === bin ? 1 : 0.72} />
                  })}
                  {h.meanHour != null && (
                    <g transform={`translate(${x(h.meanHour)},0)`} pointerEvents="none">
                      <line y1={top - 2} y2={top + ROW_H} stroke={SIGNAL.ink} strokeWidth={1.25} />
                      <path d={`M-4,${top - 4}L4,${top - 4}L0,${top + 1}Z`} fill={SIGNAL.ink} />
                    </g>
                  )}
                </g>
              )
            })}
            <HourAxis x={x} from={from} to={to} y={axisY} step={hourStep(innerW, to - from)} />
            {hour && <line x1={x(hour.h)} x2={x(hour.h)} y1={H_M.top} y2={axisY} stroke={SIGNAL.ink} strokeOpacity={0.35} pointerEvents="none" />}
            <rect
              y={H_M.top}
              width={innerW}
              height={axisY - H_M.top}
              fill="transparent"
              onPointerMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                const px = e.clientX - r.left
                setHour({ h: x.invert(px), px: px + H_M.left, py: e.clientY - r.top + H_M.top })
              }}
              onPointerLeave={() => setHour(null)}
            />
          </g>
        </svg>
      )}
      {hour && bin >= 0 && (
        <HoverCard
          x={hour.px}
          y={hour.py}
          containerW={width}
          title={`${clock(12 + bin * v.binH)} – ${clock(12 + (bin + 1) * v.binH)}`}
          rows={v.hists.map((h, k) => ({ label: HISTS[k].label, value: `${h.counts[bin] ?? 0} nights`, color: HISTS[k].color, kind: 'swatch' as const }))}
        />
      )}
    </div>
  )
}

/** Smallest of 1, 2, 3, 6 h that keeps hour labels at least 48 px apart. */
const hourStep = (innerW: number, hours: number) => [1, 2, 3, 6].find((s) => (innerW / hours) * s >= 48) ?? 6

const W_M = { top: 4, right: 22, bottom: 30, left: 76 }
const W_ROW = 30

/** Deterministic vertical jitter so a row of dots reads as a strip, not a line. */
const jitter = (i: number) => (((i * 2654435761) >>> 0) % 1000) / 1000 - 0.5

function WeekdayDots({ v }: { v: ChronoView }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [row, setRow] = useState<{ i: number; px: number; py: number } | null>(null)
  const height = W_M.top + v.weekday.length * W_ROW + W_M.bottom
  const innerW = Math.max(0, width - W_M.left - W_M.right)
  const [from, to] = v.weekdayDomain
  const x = scaleLinear().domain([from, to]).range([0, innerW])
  const axisY = W_M.top + v.weekday.length * W_ROW
  const hovered = row ? v.weekday[row.i] : null

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Mid-sleep by weekday">
          <g transform={`translate(${W_M.left},0)`}>
            {v.weekday.map((w, i) => {
              const cy = W_M.top + i * W_ROW + W_ROW / 2
              const kind = DAY_KIND[w.free ? 'free' : 'work']
              return (
                <g key={w.label} opacity={row && row.i !== i ? 0.45 : 1}>
                  <line x1={0} x2={innerW} y1={cy} y2={cy} stroke={AX.grid} />
                  <text x={-10} y={cy} dy="0.32em" textAnchor="end" fontSize={11} fill={w.free ? AX.labelStrong : AX.label}>
                    {w.free ? `${w.label} · free` : w.label}
                  </text>
                  {w.values.map((h, k) =>
                    h < from || h > to ? null : w.free ? (
                      <circle key={k} cx={x(h)} cy={cy + jitter(k) * (W_ROW - 12)} r={2.4} fill="none" stroke={kind.color} strokeOpacity={0.75} strokeWidth={1.1} />
                    ) : (
                      <circle key={k} cx={x(h)} cy={cy + jitter(k) * (W_ROW - 12)} r={2} fill={kind.color} fillOpacity={0.55} />
                    ),
                  )}
                  {w.median != null && <line x1={x(w.median)} x2={x(w.median)} y1={cy - W_ROW / 2 + 3} y2={cy + W_ROW / 2 - 3} stroke={SIGNAL.ink} strokeWidth={2} strokeLinecap="round" />}
                </g>
              )
            })}
            <HourAxis x={x} from={from} to={to} y={axisY} step={hourStep(innerW, to - from)} />
            <rect
              y={W_M.top}
              width={innerW}
              height={axisY - W_M.top}
              fill="transparent"
              onPointerMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                const py = e.clientY - r.top
                setRow({ i: Math.max(0, Math.min(v.weekday.length - 1, Math.floor(py / W_ROW))), px: e.clientX - r.left + W_M.left, py: py + W_M.top })
              }}
              onPointerLeave={() => setRow(null)}
            />
          </g>
        </svg>
      )}
      {row && hovered && (
        <HoverCard
          x={row.px}
          y={row.py}
          containerW={width}
          title={`${hovered.label} nights · ${hovered.free ? 'before a free day' : 'before a work day'}`}
          rows={[
            { label: 'median mid-sleep', value: clock(hovered.median), color: DAY_KIND[hovered.free ? 'free' : 'work'].color, kind: 'dot' },
            { label: 'nights', value: fixed(hovered.values.length) },
          ]}
        />
      )}
    </div>
  )
}

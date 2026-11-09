import { scaleLinear } from 'd3-scale'
import { area } from 'd3-shape'
import { useMemo, useState } from 'react'
import { useObservatory } from '@/app/context'
import { inkOn, ramps, SIGNAL, STAGES, type StageKey } from '@/core/color'
import type { Architecture as ArchitectureData } from '@/core/domain'
import { fixed } from '@/core/format'
import { duration } from '@/core/time'
import { useArchitecture } from '@/infra/queries'
import { AX, useWidth, ValueAxis } from '@/ui/charts/axes'
import { Figure, Legend, RampLegend } from '@/ui/charts/Figure'
import { HoverCard } from '@/ui/charts/HoverCard'
import { EmptyState } from '@/ui/primitives'
import { loadable } from './data'
import { Frame, PanelLabel } from './Frame'

/** Bottom-to-top stacking order, deepest stage on the baseline. */
const STACK = STAGES
const STAGE_LABEL: Record<string, string> = Object.fromEntries(STAGES.map((s) => [s.key, s.label]))
const pct = (v: number | null | undefined) => (v == null ? '—' : `${fixed(v * 100, 1)}%`)

interface ArchView {
  minutes: number
  /** per stage, probability by minute since onset */
  prob: Record<StageKey, number[]>
  /** cumulative tops per stage, in STACK order */
  stacked: { key: StageKey; color: string; lo: number[]; hi: number[] }[]
  order: string[]
  transitions: number[][]
  counts: number[][]
  nights: number
  deepPeak: { minute: number; p: number }
  topTransition: { from: string; to: string; p: number; n: number } | null
}

function toView(a: ArchitectureData): ArchView | null {
  const m = a.minutes
  if (!m || a.nights < 1) return null
  const prob = Object.fromEntries(STACK.map((s) => [s.key, Array.from({ length: m }, (_, i) => a.probability[s.key]?.[i] ?? 0)])) as Record<StageKey, number[]>
  const base = new Array<number>(m).fill(0)
  const stacked = STACK.map((s) => {
    const lo = base.slice()
    prob[s.key].forEach((p, i) => (base[i] += p))
    return { key: s.key, color: s.color, lo, hi: base.slice() }
  })
  let deepPeak = { minute: 0, p: 0 }
  prob.deep.forEach((p, i) => p > deepPeak.p && (deepPeak = { minute: i, p }))
  const transitions = a.transitions.map((r) => r.map((v) => v ?? 0))
  const counts = a.transition_counts.map((r) => r.map((v) => v ?? 0))
  let topTransition: ArchView['topTransition'] = null
  counts.forEach((row, i) =>
    row.forEach((n, j) => {
      if (n > (topTransition?.n ?? 0)) topTransition = { from: a.order[i], to: a.order[j], p: transitions[i][j], n }
    }),
  )
  return { minutes: m, prob, stacked, order: a.order, transitions, counts, nights: a.nights, deepPeak, topTransition }
}

export function Architecture() {
  const { range } = useObservatory()
  const state = loadable(useArchitecture(range))
  return <Frame state={state} height={320}>{(a, fetching) => <ArchitectureFigure data={a} fetching={fetching} />}</Frame>
}

function ArchitectureFigure({ data, fetching }: { data: ArchitectureData; fetching: boolean }) {
  const v = useMemo(() => toView(data), [data])
  const t = v?.topTransition
  return (
    <Figure
      index="2.5"
      title="The shape of a typical night"
      caption="Left, the share of nights in each stage at every minute after onset; the unfilled top is nights already over. Right, where each stage goes next."
      reading={
        v
          ? `Deep sleep peaks ${duration(v.deepPeak.minute)} after onset, in ${pct(v.deepPeak.p)} of ${v.nights} nights.${t ? ` The commonest step is ${STAGE_LABEL[t.from]} to ${STAGE_LABEL[t.to]} (${pct(t.p)} of exits from ${STAGE_LABEL[t.from]}).` : ''}`
          : undefined
      }
      legend={<Legend items={[...STACK].reverse().map((s) => ({ label: s.label, color: s.color }))} />}
      method={{
        body: (
          <>
            <p>Every main episode is aligned at its onset. At each minute the chart shows the fraction of all nights in the range staged Deep, Core, REM or Awake. Nights that have ended count toward none, so the stack thins toward the morning.</p>
            <p>The matrix is a first-order Markov estimate. Each cell is the share of transitions out of the row's stage that land in the column's stage, counted between consecutive distinct stages. The diagonal is empty by construction.</p>
          </>
        ),
      }}
      fetching={fetching}
    >
      {v ? (
        <div className="grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <PanelLabel title="Stage probability by time since onset" />
            <StageArea v={v} />
          </div>
          <div className="min-w-0">
            <PanelLabel title="Transitions, from row to column" />
            <TransitionMatrix v={v} />
          </div>
        </div>
      ) : (
        <EmptyState title="No staged nights">No main episode with stage data falls inside the range.</EmptyState>
      )}
    </Figure>
  )
}

const AREA_M = { top: 8, right: 12, bottom: 28, left: 44 }
const AREA_H = 280

function StageArea({ v }: { v: ArchView }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<{ minute: number; px: number; py: number } | null>(null)
  const innerW = Math.max(0, width - AREA_M.left - AREA_M.right)
  const innerH = AREA_H - AREA_M.top - AREA_M.bottom
  const x = scaleLinear().domain([0, v.minutes]).range([0, innerW])
  const y = scaleLinear().domain([0, 1]).range([innerH, 0])
  const paths = useMemo(() => {
    const sx = scaleLinear().domain([0, v.minutes]).range([0, innerW])
    const sy = scaleLinear().domain([0, 1]).range([innerH, 0])
    return v.stacked.map((s) => ({
      key: s.key,
      color: s.color,
      d:
        area<number>()
          .x((_, i) => sx(i))
          .y0((_, i) => sy(s.lo[i]))
          .y1((h) => sy(h))(s.hi) ?? '',
    }))
  }, [v, innerW, innerH])
  const hours = Array.from({ length: Math.floor(v.minutes / 60) + 1 }, (_, h) => h)
  const m = hover?.minute

  return (
    <div ref={ref} className="relative" style={{ height: AREA_H }}>
      {width > 0 && (
        <svg width={width} height={AREA_H} role="img" aria-label="Stage probability by minute since onset">
          <g transform={`translate(${AREA_M.left},${AREA_M.top})`}>
            <ValueAxis ticks={[0, 0.25, 0.5, 0.75, 1]} y={y} x={0} width={innerW} format={(t) => `${Math.round(t * 100)}%`} />
            {paths.map((p) => (
              <path key={p.key} d={p.d} fill={p.color} fillOpacity={0.85} stroke="var(--color-surface)" strokeWidth={1} />
            ))}
            {hours.map((h) => (
              <g key={h} transform={`translate(${x(h * 60)},${innerH})`}>
                <line y2={5} stroke={AX.rule} />
                <text y={18} textAnchor="middle" fontSize={AX.font} fill={AX.label}>
                  {h}h
                </text>
              </g>
            ))}
            {m != null && (
              <g pointerEvents="none">
                <line x1={x(m)} x2={x(m)} y1={0} y2={innerH} stroke={SIGNAL.ink} strokeOpacity={0.6} />
                {v.stacked.map((s) => (
                  <circle key={s.key} cx={x(m)} cy={y(s.hi[m])} r={3} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />
                ))}
              </g>
            )}
            <rect
              width={innerW}
              height={innerH}
              fill="transparent"
              onPointerMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                const px = e.clientX - r.left
                setHover({ minute: Math.max(0, Math.min(v.minutes - 1, Math.round(x.invert(px)))), px: px + AREA_M.left, py: e.clientY - r.top + AREA_M.top })
              }}
              onPointerLeave={() => setHover(null)}
            />
          </g>
        </svg>
      )}
      {hover && m != null && (
        <HoverCard
          x={hover.px}
          y={hover.py}
          containerW={width}
          title={`${duration(m)} after onset`}
          rows={[...STACK].reverse().map((s) => ({ label: s.label, value: pct(v.prob[s.key][m]), color: s.color, kind: 'swatch' as const }))}
          footer={`Episode over in ${pct(1 - v.stacked[v.stacked.length - 1].hi[m])} of nights`}
        />
      )}
    </div>
  )
}

const CELL_M = { top: 22, left: 60 }

function TransitionMatrix({ v }: { v: ArchView }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<{ i: number; j: number } | null>(null)
  const n = v.order.length
  const size = Math.max(0, Math.min(260, width - CELL_M.left - 4))
  const c = size / n
  const max = Math.max(...v.transitions.flat(), 1e-9)
  const fill = (p: number) => ramps.indigo(0.12 + 0.88 * (p / max))
  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={size + CELL_M.top + 4} role="img" aria-label="Stage transition matrix">
          <g transform={`translate(${CELL_M.left},${CELL_M.top})`}>
            {v.order.map((k, j) => (
              <text key={k} x={j * c + c / 2} y={-8} textAnchor="middle" fontSize={AX.font} fill={AX.labelStrong}>
                {short(k)}
              </text>
            ))}
            {v.order.map((k, i) => (
              <text key={k} x={-8} y={i * c + c / 2} dy="0.32em" textAnchor="end" fontSize={AX.font} fill={AX.labelStrong}>
                {short(k)}
              </text>
            ))}
            {v.transitions.map((row, i) =>
              row.map((p, j) => {
                const self = i === j
                const bg = self ? SIGNAL.raised : fill(p)
                const on = hover?.i === i && hover?.j === j
                return (
                  <g key={`${i}-${j}`} transform={`translate(${j * c},${i * c})`} onPointerEnter={() => setHover({ i, j })} onPointerLeave={() => setHover(null)}>
                    <rect x={1} y={1} width={c - 2} height={c - 2} rx={3} fill={bg} stroke={on ? SIGNAL.ink : 'none'} strokeWidth={1.5} />
                    <text x={c / 2} y={c / 2} dy="0.32em" textAnchor="middle" fontSize={11} className="num" fill={self ? SIGNAL.ink4 : inkOn(bg)} pointerEvents="none">
                      {self ? '–' : `${Math.round(p * 100)}%`}
                    </text>
                  </g>
                )
              }),
            )}
          </g>
        </svg>
      )}
      <div className="mt-3" style={{ marginLeft: CELL_M.left }}>
        <RampLegend ramp={(t) => fill(t * max)} label="Share of exits" ticks={[{ at: 0, label: '0%' }, { at: 1, label: `${Math.round(max * 100)}%` }]} width={140} />
      </div>
      {hover && hover.i !== hover.j && (
        <HoverCard
          x={CELL_M.left + (hover.j + 0.5) * c}
          y={CELL_M.top + (hover.i + 0.5) * c}
          containerW={width}
          title={`${STAGE_LABEL[v.order[hover.i]]} to ${STAGE_LABEL[v.order[hover.j]]}`}
          rows={[
            { label: 'of exits from ' + STAGE_LABEL[v.order[hover.i]], value: pct(v.transitions[hover.i][hover.j]) },
            { label: 'transitions', value: fixed(v.counts[hover.i][hover.j]) },
          ]}
        />
      )}
    </div>
  )
}

const short = (k: string) => (k === 'awake' ? 'Awake' : STAGE_LABEL[k] ?? k)

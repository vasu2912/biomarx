import { area, line } from 'd3-shape'
import { useMemo, useState } from 'react'
import { SIGNAL, withAlpha } from '@/core/color'
import type { HrActivity } from '@/core/domain'
import { fixed } from '@/core/format'
import { AX, useWidth } from '@/ui/charts/axes'
import { Figure, FigureSkeleton, Legend } from '@/ui/charts/Figure'
import { HoverCard } from '@/ui/charts/HoverCard'
import { EmptyState } from '@/ui/primitives'

const STATES = [
  { key: 'asleep', label: 'Asleep', color: SIGNAL.cool },
  { key: 'awake', label: 'Awake', color: SIGNAL.ember },
] as const
type StateKey = (typeof STATES)[number]['key']

const MARGIN = { top: 8, right: 16, bottom: 40, left: 64 }
/** ridge peak height as a multiple of the row step; just over 1 so neighbours touch without hiding each other */
const OVERLAP = 1.35

interface Ridge {
  month: string
  label: string
  density: Record<StateKey, number[] | null>
  mode: Record<StateKey, number | null>
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`

function modeOf(hr: number[], d: number[] | null): number | null {
  if (!d?.length) return null
  let k = 0
  d.forEach((v, i) => v > d[k] && (k = i))
  return hr[k]
}

const dense = (d: (number | null)[] | null | undefined) => (d ? d.map((v) => v ?? 0) : null)

function toRidges(hr: number[], r: HrActivity['ridgeline']): Ridge[] {
  return r.months
    .filter((m) => m.awake || m.asleep)
    .map((m) => {
      const density = { awake: dense(m.awake), asleep: dense(m.asleep) }
      return { month: m.month, label: monthLabel(m.month), density, mode: { awake: modeOf(hr, density.awake), asleep: modeOf(hr, density.asleep) } }
    })
}

function pooledMode(hr: number[], ridges: Ridge[], key: StateKey): number | null {
  const sum = hr.map(() => 0)
  let n = 0
  for (const r of ridges) {
    const d = r.density[key]
    if (!d) continue
    d.forEach((v, i) => (sum[i] += v))
    n++
  }
  return n ? modeOf(hr, sum) : null
}

export function RidgelineFigure({ data, fetching }: { data: HrActivity | undefined; fetching: boolean }) {
  const hr = useMemo(() => (data ? data.ridgeline.hr.map((v) => v ?? NaN) : []), [data])
  const ridges = useMemo(() => (data ? toRidges(hr, data.ridgeline) : []), [data, hr])

  if (!data) return <FigureSkeleton height={420} />
  const n = ridges.length
  const asleepMode = pooledMode(hr, ridges, 'asleep')
  const awakeMode = pooledMode(hr, ridges, 'awake')

  return (
    <Figure
      index="4.6"
      title="Monthly heart-rate distribution"
      caption="One ridge per month, oldest at the top: where heart rate spends its time while asleep and awake. Each ridge is scaled to its own peak."
      reading={
        asleepMode != null && awakeMode != null ? (
          <>
            Pooled over {n} months, asleep HR peaks at <b className="num">{asleepMode} bpm</b> and awake HR at <b className="num">{awakeMode} bpm</b>, a gap of{' '}
            {awakeMode - asleepMode} bpm.
          </>
        ) : undefined
      }
      legend={n ? <Legend items={STATES.map((s) => ({ label: s.label, color: s.color, kind: 'band' as const }))} /> : undefined}
      method={{
        body: 'Minute heart-rate samples are split into asleep and awake by the sleep record, subsampled to at most 15,000 per month, and smoothed with a Gaussian kernel density estimate (bandwidth factor 0.15) on a 1 bpm grid. A month needs at least 200 samples per state. Each density is divided by its own maximum, so ridges compare shape and position, not volume.',
      }}
      fetching={fetching}
    >
      {n === 0 ? (
        <EmptyState title="No monthly distributions">No month in this range has enough heart-rate samples.</EmptyState>
      ) : (
        <RidgePlot hr={hr} ridges={ridges} />
      )}
    </Figure>
  )
}

function RidgePlot({ hr, ridges }: { hr: number[]; ridges: Ridge[] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  const n = ridges.length
  const step = Math.max(12, Math.min(40, 520 / Math.max(1, n)))
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right)
  const top = step * (OVERLAP - 1) + 4
  const innerH = top + n * step
  const height = innerH + MARGIN.top + MARGIN.bottom
  const lo = hr[0]
  const hi = hr[hr.length - 1]
  const x = (v: number) => ((v - lo) / (hi - lo)) * innerW
  const base = (i: number) => top + (i + 1) * step
  const amp = step * OVERLAP
  const labelEvery = Math.ceil(14 / step)
  const xt = Array.from({ length: Math.floor((hi - 40) / 20) + 1 }, (_, i) => 40 + i * 20)

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const py = e.clientY - rect.top
    const i = Math.max(0, Math.min(n - 1, Math.floor((py - top) / step)))
    setHover({ i, x: e.clientX - rect.left + MARGIN.left, y: py + MARGIN.top })
  }

  return (
        <div ref={ref} className="relative" style={{ height }}>
          {width > 0 && (
            <svg width={width} height={height} role="img" aria-label="Ridgeline of monthly heart-rate density, asleep and awake">
              <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
                {xt.map((t) => (
                  <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={innerH} stroke={AX.grid} />
                ))}
                {ridges.map((r, i) => {
                  const dim = hover != null && hover.i !== i
                  return (
                    <g key={r.month} opacity={dim ? 0.35 : 1}>
                      {STATES.map((s) => {
                        const d = r.density[s.key]
                        if (!d) return null
                        const y = (v: number) => base(i) - v * amp
                        const ar = area<number>()
                          .x((_, k) => x(hr[k]))
                          .y0(base(i))
                          .y1(y)(d)
                        const ln = line<number>()
                          .x((_, k) => x(hr[k]))
                          .y(y)(d)
                        return (
                          <g key={s.key}>
                            <path d={ar ?? ''} fill={withAlpha(s.color, 0.16)} />
                            <path d={ln ?? ''} fill="none" stroke={s.color} strokeWidth={1.25} strokeLinejoin="round" />
                          </g>
                        )
                      })}
                      <line x1={0} x2={innerW} y1={base(i)} y2={base(i)} stroke={AX.grid} />
                      {(i % labelEvery === 0 || hover?.i === i) && (
                        <text x={-8} y={base(i)} dy="-0.2em" textAnchor="end" fontSize={AX.font} fill={hover?.i === i ? AX.labelStrong : AX.label}>
                          {r.label}
                        </text>
                      )}
                    </g>
                  )
                })}
                {xt.map((t) => (
                  <g key={t} transform={`translate(${x(t)},${innerH})`}>
                    <line y1={0} y2={5} stroke={AX.rule} />
                    <text y={17} textAnchor="middle" fontSize={AX.font} fill={AX.label}>
                      {t}
                    </text>
                  </g>
                ))}
                <text x={innerW / 2} y={innerH + 34} textAnchor="middle" fontSize={AX.font} fill={AX.labelStrong}>
                  Heart rate, bpm
                </text>
                <rect width={innerW} height={innerH} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
              </g>
            </svg>
          )}
          {hover && ridges[hover.i] && (
            <HoverCard
              x={hover.x}
              y={hover.y}
              containerW={width}
              title={ridges[hover.i].label}
              rows={STATES.map((s) => {
                const m = ridges[hover.i].mode[s.key]
                return { label: `${s.label.toLowerCase()} mode`, color: s.color, value: m == null ? '—' : `${fixed(m)} bpm` }
              })}
            />
          )}
        </div>
  )
}

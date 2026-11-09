import { ArrowDown, ArrowRight, ArrowUp, Minus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router'
import type { Daily, MetricDef, Summary } from '@/core/domain'
import { clockDiff, deltaTone, formatDelta, formatMetric, unitSuffix, type DeltaTone } from '@/core/format'
import { def, K, METRIC_COLOR, type Registry } from '@/core/metrics'
import { chunkMean, extent, isNum, unwrapEvening } from '@/core/stats'
import { formatDate, type IsoDate } from '@/core/time'
import { SIGNAL } from '@/core/color'
import { useWidth } from '@/ui/charts/axes'
import { cn, Ticker } from '@/ui/primitives'

export const VITAL_GROUPS = [
  { group: 'Sleep', path: '/sleep', keys: [K.tst, K.onset, K.offset, K.eff, K.sri] },
  { group: 'Heart', path: '/heart', keys: [K.rhr, K.hrv, K.nightHr, K.dip] },
  { group: 'Rhythm', path: '/rhythm', keys: [K.amp, K.acro, K.isSteps] },
  { group: 'Activity', path: '/mobility', keys: [K.steps, K.walkSpeed] },
] as const

export const VITAL_KEYS: readonly string[] = VITAL_GROUPS.flatMap((g) => g.keys)

const EVENING = new Set<string>([K.onset])

interface Tile {
  def: MetricDef
  value: number | null
  delta: number | null
  tone: DeltaTone
  flat: boolean
  color: string
  weeks: { start: IsoDate; value: number | null }[]
}

export interface VitalGroup {
  group: string
  path: string
  tiles: Tile[]
}

export function buildVitals(registry: Registry, cur: Summary, prev: Summary | undefined, daily: Daily | undefined): VitalGroup[] {
  return VITAL_GROUPS.map((g) => ({
    group: g.group,
    path: g.path,
    tiles: g.keys.map((key): Tile => {
      const d = def(registry, key)
      const value = cur.values[key] ?? null
      const before = prev?.values[key] ?? null
      const delta = isNum(value) && isNum(before) ? (d.clock ? clockDiff(value, before) : value - before) : null
      const eps = d.clock ? 0.5 / 60 : 0.5 * 10 ** -d.decimals
      const col = daily?.columns[key] ?? []
      const series = EVENING.has(key) ? col.map((v) => unwrapEvening(v)) : col
      const means = chunkMean(series, 7)
      return {
        def: d,
        value,
        delta,
        tone: delta == null ? 'neutral' : deltaTone(delta, d.direction, eps),
        flat: delta == null || Math.abs(delta) < eps,
        color: METRIC_COLOR[key] ?? SIGNAL.ink2,
        weeks: means.map((v, i) => ({ start: daily!.days[i * 7], value: v })),
      }
    }),
  }))
}

const TONE_CLASS: Record<DeltaTone, string> = { good: 'text-good', bad: 'text-bad', neutral: 'text-ink-3' }

export function VitalSigns({ groups, hasPrev }: { groups: VitalGroup[]; hasPrev: boolean }) {
  const { search } = useLocation()
  return (
    <div className="divide-y divide-hairline border-y border-hairline">
      {groups.map((g) => (
        <section key={g.group} className="grid gap-4 py-5 md:grid-cols-[132px_1fr]">
          <div className="flex items-baseline justify-between md:flex-col md:justify-start md:gap-2">
            <h4 className="eyebrow">{g.group}</h4>
            <Link
              to={{ pathname: g.path, search }}
              className="inline-flex items-center gap-1 text-[12px] text-ink-3 transition-colors hover:text-ink"
            >
              Chapter <ArrowRight size={12} aria-hidden />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
            {g.tiles.map((t) => (
              <StatTile key={t.def.key} tile={t} hasPrev={hasPrev} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function StatTile({ tile, hasPrev }: { tile: Tile; hasPrev: boolean }) {
  const { def: d, value, delta, tone } = tile
  const suffix = unitSuffix(d)
  const fmt = useMemo(() => (v: number | null) => formatMetric(d, v), [d])
  const [hover, setHover] = useState<number | null>(null)
  const week = hover != null ? tile.weeks[hover] : null
  const Arrow = tile.flat || delta == null ? Minus : delta > 0 ? ArrowUp : ArrowDown
  return (
    <div className="min-w-0">
      <div className="truncate text-[12px] text-ink-3" title={d.description}>
        {d.label}
      </div>
      <div className="mt-1 flex items-baseline gap-1 text-[24px] leading-none font-semibold text-ink">
        <Ticker value={value} format={fmt} />
        {suffix && <span className="text-[12px] font-normal text-ink-3">{suffix}</span>}
      </div>
      <div className="mt-1.5 h-4 text-[11.5px]">
        {week ? (
          <span className="num text-ink-2">
            wk of {formatDate(week.start)} · {formatMetric(d, week.value)}
          </span>
        ) : delta != null ? (
          <span className={cn('num inline-flex items-center gap-1', TONE_CLASS[tone])}>
            <Arrow size={11} aria-hidden />
            {formatDelta(d, delta)}
            {suffix && ` ${suffix}`}
            <span className="text-ink-4">vs prior</span>
          </span>
        ) : (
          <span className="text-ink-4">{hasPrev ? 'no prior value' : 'no prior period'}</span>
        )}
      </div>
      <Sparkline weeks={tile.weeks} color={tile.color} hover={hover} onHover={setHover} label={`${d.label}, weekly mean`} />
    </div>
  )
}

const SPARK_H = 26

function Sparkline({
  weeks,
  color,
  hover,
  onHover,
  label,
}: {
  weeks: Tile['weeks']
  color: string
  hover: number | null
  onHover: (i: number | null) => void
  label: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const n = weeks.length
  const geom = useMemo(() => {
    const e = extent(weeks.map((w) => w.value))
    if (!e || n < 2 || width <= 0) return null
    const [lo, hi] = e
    const x = (i: number) => (i / (n - 1)) * width
    const y = (v: number) => SPARK_H - 3 - ((v - lo) / (hi - lo || 1)) * (SPARK_H - 6)
    let d = ''
    let pen = false
    weeks.forEach((w, i) => {
      if (!isNum(w.value)) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(w.value).toFixed(1)}`
      pen = true
    })
    return { d, x, y }
  }, [weeks, n, width])

  const hv = hover != null ? weeks[hover]?.value : null
  return (
    <div ref={ref} className="mt-1.5" style={{ height: SPARK_H }}>
      {geom && (
        <svg
          width={width}
          height={SPARK_H}
          role="img"
          aria-label={label}
          className="overflow-visible"
          onPointerMove={(e) => {
            const px = e.clientX - e.currentTarget.getBoundingClientRect().left
            onHover(Math.max(0, Math.min(n - 1, Math.round((px / width) * (n - 1)))))
          }}
          onPointerLeave={() => onHover(null)}
        >
          <path d={geom.d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
          {hover != null && isNum(hv) && (
            <g pointerEvents="none">
              <line x1={geom.x(hover)} x2={geom.x(hover)} y1={0} y2={SPARK_H} stroke="rgba(236,234,228,0.14)" />
              <circle cx={geom.x(hover)} cy={geom.y(hv)} r={3} fill={color} stroke="var(--color-surface)" strokeWidth={2} />
            </g>
          )}
          <rect width={width} height={SPARK_H} fill="transparent" />
        </svg>
      )}
    </div>
  )
}

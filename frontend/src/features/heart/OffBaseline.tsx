import { useMemo, useState } from 'react'
import { useUi } from '@/app/store'
import { buildLut, ramps, SIGNAL } from '@/core/color'
import type { Baseline, BaselineSignal } from '@/core/domain'
import { fixed, formatMetric, signed, unitSuffix } from '@/core/format'
import { def, K, type Registry } from '@/core/metrics'
import { formatDate } from '@/core/time'
import { AX, DayAxisBottom, useWidth } from '@/ui/charts/axes'
import { Figure, FigureSkeleton, Legend } from '@/ui/charts/Figure'
import { HoverCard } from '@/ui/charts/HoverCard'
import { paintLut, RasterCanvas } from '@/ui/charts/RasterCanvas'
import { EmptyState } from '@/ui/primitives'

/** Same ramp and clamp as the daily state raster in Patterns, so a cell at z = +2 reads the same color on both pages. */
const LUT = buildLut(ramps.diverging)
const Z_CLAMP = 3
const EMPTY: [number, number, number, number] = [15, 19, 24, 255]
const NO_BASELINE = `rgb(${EMPTY.slice(0, 3).join(',')})`
const NEUTRAL = Math.round(((0 + Z_CLAMP) / (2 * Z_CLAMP)) * (LUT.size - 1))
const MARK = LUT.size
const ROW_H = 15
const MARGIN = { top: 2, right: 4, bottom: 26, left: 146 }

const zIndex = (c: number) => Math.round(((Math.min(Z_CLAMP, c) + Z_CLAMP) / (2 * Z_CLAMP)) * (LUT.size - 1))
/** The LUT plus one extra entry for the concurrent-night mark. */
const LUT_BYTES = (() => {
  const b = new Uint8ClampedArray((LUT.size + 1) * 4)
  b.set(LUT.bytes)
  b.set([244, 185, 74, 255], LUT.size * 4)
  return b
})()

const LABEL: Record<string, string> = {
  [K.rhr]: 'Resting HR',
  [K.hrv]: 'Night HRV (SDNN)',
  [K.resp]: 'Respiratory rate',
  [K.nightHr]: 'Sleeping HR',
  [K.spo2]: 'Night SpO2',
  wrist_temp: 'Wrist temperature',
}
const WRIST = { unit: '°C', decimals: 2, clock: false }

const fmt = (registry: Registry, key: string) => (key === 'wrist_temp' ? WRIST : def(registry, key))
const withUnit = (registry: Registry, key: string, v: number | null | undefined) => {
  const d = fmt(registry, key)
  return v == null ? '—' : `${formatMetric(d, v)} ${unitSuffix(d)}`.trim()
}
/** z with the sign turned so that positive always means the concerning direction. */
const concernZ = (s: BaselineSignal, i: number) => {
  const z = s.z[i]
  return z == null ? null : s.concern === 'up' ? z : -z
}

export function OffBaselineFigure({ data, registry, fetching }: { data: Baseline | undefined; registry: Registry; fetching: boolean }) {
  if (!data) return <FigureSkeleton height={160} />
  const flagged = data.days.filter((_, i) => data.concurrent[i] >= data.min_concurrent)
  const scored = data.signals.some((s) => s.z.some((z) => z != null))
  const last = flagged[flagged.length - 1]

  return (
    <Figure
      index="4.7"
      title="Off your baseline"
      caption={`Each night against your own previous ${data.baseline_nights} nights. A cell lights only when the signal moved at least ${data.flag_z} robust z in the direction that tends to come with illness or strain; the top row marks nights where ${data.min_concurrent} or more did at once.`}
      reading={
        scored ? (
          flagged.length ? (
            <>
              <b className="num">{fixed(flagged.length)}</b> {flagged.length === 1 ? 'night' : 'nights'} in this range had {data.min_concurrent} or more signals off baseline at
              once, most recently {formatDate(last, { weekday: true, year: true })}.
            </>
          ) : (
            <>No night in this range had {data.min_concurrent} or more signals off baseline at once.</>
          )
        ) : undefined
      }
      legend={
        scored ? (
          <Legend
            items={[
              { label: `${data.min_concurrent}+ signals at once`, color: SIGNAL.sun },
              { label: `≥ ${data.flag_z} z, concerning direction`, color: ramps.diverging(zIndex(data.flag_z) / (LUT.size - 1)) },
              { label: 'Within baseline', color: ramps.diverging(0.5) },
              { label: 'No baseline yet', color: NO_BASELINE },
            ]}
          />
        ) : undefined
      }
      method={{
        body: (
          <>
            <p>
              For each night, the baseline is the median of the same signal over the {data.baseline_nights} nights before it, never including the night itself. The spread is
              1.4826 × the median absolute deviation, which matches the standard deviation for normal data but is not pulled by a few odd nights. The deviation is a robust z:
              (value − median) / spread. A night needs at least {data.min_baseline_nights} nights with the signal in its window, otherwise it gets no z.
            </p>
            <p>
              Concerning directions: resting HR the next morning up, night HRV (SDNN) down, respiratory rate up, sleeping HR up, night SpO2 down, and wrist temperature up when
              the watch records it. Studies of wearable data have seen resting heart rate and related signals rise above a person’s own baseline in the days before an
              infection was diagnosed.
            </p>
            <p>This is not a diagnosis and no score is computed: the figure only shows which signals moved, side by side. Alcohol, a late meal, travel, hard training or a bad night can do the same.</p>
          </>
        ),
        cite: 'Leys C et al. J Exp Soc Psychol 2013;49:764–766. Background: Radin JM et al. Lancet Digit Health 2020;2:e85–e93; Mishra T et al. Nat Biomed Eng 2020;4:1208–1220.',
      }}
      fetching={fetching}
    >
      {scored ? (
        <BaselineRaster data={data} registry={registry} />
      ) : (
        <EmptyState title="No baseline yet">A night needs at least {data.min_baseline_nights} nights with the signal in the {data.baseline_nights} before it.</EmptyState>
      )}
    </Figure>
  )
}

function BaselineRaster({ data, registry }: { data: Baseline; registry: Registry }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null)
  const hoverDay = useUi((s) => s.hoverDay)
  const setHoverDay = useUi((s) => s.setHoverDay)
  const cols = data.days.length
  const rows = data.signals.length + 1
  const cells = useMemo(() => {
    const out = new Float64Array(rows * cols)
    data.concurrent.forEach((n, i) => (out[i] = n >= data.min_concurrent ? MARK : -1))
    data.signals.forEach((s, r) =>
      s.z.forEach((_, i) => {
        const c = concernZ(s, i)
        out[(r + 1) * cols + i] = c == null ? -1 : c >= data.flag_z ? zIndex(c) : NEUTRAL
      }),
    )
    return out
  }, [data, rows, cols])
  const paint = useMemo(() => paintLut(cells, LUT_BYTES, (v) => v, EMPTY), [cells])
  const height = MARGIN.top + rows * ROW_H + MARGIN.bottom
  const hoverCol = hoverDay ? data.days.indexOf(hoverDay) : -1
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right)

  return (
    <div ref={ref} className="relative">
      <RasterCanvas
        rows={rows}
        cols={cols}
        paint={paint}
        height={height}
        margin={MARGIN}
        label="Nightly deviation of each signal from its own trailing baseline"
        onHover={(c) => {
          setHover(c)
          setHoverDay(c ? data.days[c.col] : null)
        }}
        overlay={(g) => (
          <>
            {[`${data.min_concurrent}+ at once`, ...data.signals.map((s) => `${LABEL[s.key] ?? s.key} ${s.concern === 'up' ? '↑' : '↓'}`)].map((label, r) => (
              <text key={label} x={-10} y={g.y(r) + g.rowH / 2} dy="0.32em" textAnchor="end" fontSize={AX.font + 0.5} fill={hover?.row === r || r === 0 ? SIGNAL.ink : AX.label}>
                {label}
              </text>
            ))}
            <line x1={0} x2={g.innerW} y1={g.rowH} y2={g.rowH} stroke={SIGNAL.bg} strokeWidth={2} />
            {hoverCol >= 0 && <rect x={g.x(hoverCol)} width={Math.max(1, g.x(1))} y={0} height={g.innerH} fill="none" stroke={SIGNAL.ink} strokeOpacity={0.7} />}
            <DayAxisBottom days={data.days} x={g.x} y={g.innerH + 4} />
          </>
        )}
      />
      {hover && (
        <HoverCard
          x={MARGIN.left + ((hover.col + 0.5) / cols) * innerW}
          y={MARGIN.top + hover.row * ROW_H + ROW_H}
          containerW={width}
          title={formatDate(data.days[hover.col], { weekday: true, year: true })}
          rows={data.signals.map((s) => {
            const z = s.z[hover.col]
            const c = concernZ(s, hover.col)
            const off = c != null && c >= data.flag_z
            return {
              label: LABEL[s.key] ?? s.key,
              value: withUnit(registry, s.key, s.value[hover.col]),
              sub: z == null ? `base ${withUnit(registry, s.key, s.median[hover.col])}` : `base ${withUnit(registry, s.key, s.median[hover.col])} · z ${signed(z, 1)}`,
              color: off ? ramps.diverging(zIndex(c) / (LUT.size - 1)) : c == null ? NO_BASELINE : ramps.diverging(0.5),
              kind: 'swatch' as const,
            }
          })}
          footer={`${data.concurrent[hover.col]} of ${data.signals.length} signals off baseline`}
        />
      )}
    </div>
  )
}

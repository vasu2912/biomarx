import { scaleLinear, type ScaleLinear } from 'd3-scale'
import { line } from 'd3-shape'
import { useMemo, useState } from 'react'
import { SIGNAL, withAlpha } from '@/core/color'
import type { Exposure, ExposureOutcome, Exposures, GroupCell, MetricDef, Range } from '@/core/domain'
import { fixed, formatDelta, formatMetric, unitSuffix } from '@/core/format'
import { def, type Registry } from '@/core/metrics'
import { isNum } from '@/core/stats'
import { clock, duration, formatDate } from '@/core/time'
import { useExposures } from '@/infra/queries'
import { AX, useWidth, ValueAxis } from '@/ui/charts/axes'
import { Figure, FigureSkeleton, Legend, type MethodNote } from '@/ui/charts/Figure'
import { HoverCard } from '@/ui/charts/HoverCard'
import { EmptyState, Segmented, Select } from '@/ui/primitives'
import { ALPHA, binnedMedian, formatQ, formatRho, type Pt } from './model'
import { DOT, robustDomain, tickFormat, TREND } from './PairScatter'

const INDEX = '5.4'
const TITLE = 'Before the night'
const REF = SIGNAL.ink3
const M = { top: 8, right: 12, left: 38 }
const PLOT_H = 132
const R = 2.6

const sig = (q: number | null | undefined) => isNum(q) && q < ALPHA

/** How the reading names a group of nights; exposures added later fall back to the group label. */
const NIGHTS_AFTER: Record<string, { subject: string; groups: string[] }> = {
  workout_timing: { subject: 'a workout', groups: ['', 'ending more than 3 h before sleep', 'ending 1 to 3 h before sleep', 'ending within 1 h of sleep'] },
  hard_workout_timing: { subject: 'a hard workout', groups: ['', 'ending more than 3 h before sleep', 'ending 1 to 3 h before sleep', 'ending within 1 h of sleep'] },
}

/** Yes/no exposures name both sides in full: the nights after, and the nights they are set against. */
const YES_NO: Record<string, { after: string; ref: string }> = {
  alcohol_logged: { after: 'after a day with drinks logged', ref: 'after a day with no drinks logged' },
  caffeine_logged: { after: 'after caffeine within 8 h of sleep', ref: 'after earlier or no caffeine' },
}

function yesNo(e: Exposure) {
  if (e.source === 'journal') return { after: `after a day tagged “${e.label}”`, ref: 'after a reviewed day without it' }
  return YES_NO[e.key]
}

const refNights = (e: Exposure) => yesNo(e)?.ref ?? `with ${lower(e.groups[0].label)}`

/** The exposure picker’s menu: what the watch can’t see, from your journal and from food and drink you logged in Health. */
const MENU_GROUPS = { journal: 'From your journal', logs: 'From Health logs' } as const

const BH = 'Benjamini Y, Hochberg Y. J R Stat Soc B 1995;57:289–300.'
const CITE: Record<string, string> = {
  workout_timing: `Background: Stutz J et al. Effects of evening exercise on sleep in healthy participants: a systematic review and meta-analysis. Sports Med 2019;49:269–287. ${BH}`,
  hard_workout_timing: `Background: Stutz J et al. Sports Med 2019;49:269–287. Training load: Morton RH, Fitz-Clarke JR, Banister EW. J Appl Physiol 1990;69:1171–1177. ${BH}`,
  morning_daylight: `Background: Burns AC et al. Day and night light exposure are associated with psychiatric disorders. Nat Ment Health 2023; Wright KP Jr et al. Entrainment of the human circadian clock to the natural light-dark cycle. Curr Biol 2013;23:1554–1558. ${BH}`,
  alcohol_logged: `Background: Pietilä J et al. Acute effect of alcohol intake on cardiovascular autonomic regulation during the first hours of sleep in a large real-world sample of Finnish employees. JMIR Ment Health 2018;5:e23; Ebrahim IO et al. Alcohol and sleep I: effects on normal sleep. Alcohol Clin Exp Res 2013;37:539–549. ${BH}`,
  caffeine_logged: `Background: Gardiner C et al. The effect of caffeine on subsequent sleep: a systematic review and meta-analysis. Sleep Med Rev 2023;69:101764; Drake C et al. Caffeine effects on sleep taken 0, 3, or 6 hours before going to bed. J Clin Sleep Med 2013;9:1195–1200. ${BH}`,
}

const LOGGED_NOTE = (
  <p>
    A missing log is not proof of none, so a night counts as a reference night only when day D has some other food or drink log in Health, or you reviewed day D in
    your journal without the matching tag. Nights with a log inside the sleep itself are left out.
  </p>
)

function exposureWhat(e: Exposure) {
  if (e.key === 'morning_daylight')
    return (
      <p>
        Morning daylight is the minutes of time in daylight the watch logged in the first two hours after the wake time that began day D, the end of the night before. A sample that
        straddles the edge counts for the share of it inside. A morning counts only when the watch that logs daylight was worn for at least half of those two hours, so a morning
        spent without it is missing rather than zero.
      </p>
    )
  if (e.source === 'journal')
    return (
      <p>
        Night D is the main sleep episode that starts after noon on day D. It is grouped by your journal entry for day D: tagged if day D carries “{e.label}”, not tagged if you
        reviewed day D without it. Days you haven’t reviewed are left out, so a missing entry never counts as a no. Tags are your own record.
      </p>
    )
  if (e.key === 'alcohol_logged')
    return (
      <>
        <p>
          Night D is the main sleep episode that starts after noon on day D. It counts as a night after drinks when Health has alcoholic drinks logged after midnight on day D (or
          after waking, if later) and before that night’s sleep.
        </p>
        {LOGGED_NOTE}
      </>
    )
  if (e.key === 'caffeine_logged')
    return (
      <>
        <p>
          Night D is the main sleep episode that starts after noon on day D. It counts as a night after late caffeine when the last caffeine logged in Health after midnight on day D
          (or after waking, if later) was within 8 h of that night’s sleep onset; caffeine logged only earlier, or none, sets the reference.
        </p>
        {LOGGED_NOTE}
      </>
    )
  return (
    <p>
      Night D is the main sleep episode that starts after noon on day D. Its workouts are those that ended after midnight on day D (or after waking, if later) and before that
      night’s sleep. The night is grouped by the gap from the last one’s end to sleep onset; nights with no workout at all are the reference.
      {e.key === 'hard_workout_timing' &&
        ' Only workouts whose Banister training load reached your median workout load count as hard; a night with workouts but no hard one is left out.'}
    </p>
  )
}

function exposureNote(e: Exposure, d: Exposures): MethodNote {
  const groups = e.kind === 'groups'
  return {
    body: (
      <>
        {exposureWhat(e)}
        {groups ? (
          <p>
            Each group is compared with the reference by the difference in medians, with a 95% interval from {d.resamples.toLocaleString('en-US')} bootstrap resamples of each group
            and a two-sided Mann–Whitney U test. A group needs at least {d.min_group} nights for an estimate; fewer shows only its count. Under each group, the difference is
            followed by its interval in brackets, in minutes for durations and clock times.
          </p>
        ) : (
          <p>Each panel is Spearman’s ρ between the exposure and one night measure, over nights with both; at least {d.min_paired} are needed.</p>
        )}
        <p>
          The p-values of every {groups ? 'group and measure' : 'measure'} are adjusted together with the Benjamini–Hochberg procedure; a dot marks a false discovery rate q below 0.05.
        </p>
        {e.source === 'watch' ? (
          <p>These are associations between your own nights, not causes: a day with a late workout or a sunny morning can differ from other days in many ways at once.</p>
        ) : (
          <p>These are associations between your own nights, not causes: a day you tagged or logged can differ from other days in many ways at once.</p>
        )}
      </>
    ),
    cite: CITE[e.key] ?? BH,
  }
}

/** Movement words a reader can say aloud: earlier for clock times, longer for durations. */
function moved(d: MetricDef, v: number) {
  if (d.clock) return `${duration(Math.abs(v) * 60)} ${v < 0 ? 'earlier' : 'later'}`
  const size = d.unit === 'h' || d.unit === 'min' ? formatMetric(d, Math.abs(v)) : `${formatMetric(d, Math.abs(v))} ${unitSuffix(d)}`.trim()
  return `${size} ${d.unit === 'h' || d.unit === 'min' ? (v < 0 ? 'shorter' : 'longer') : v < 0 ? 'lower' : 'higher'}`
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

function reading(e: Exposure, d: Exposures, registry: Registry) {
  if (e.kind === 'groups') {
    let best: { o: ExposureOutcome; g: number; c: GroupCell } | null = null
    let tested = 0
    for (const o of d.outcomes)
      o.cells.forEach((c, g) => {
        if (g === 0 || !isNum(c.q)) return
        tested++
        if (sig(c.q) && (!best || c.q! < best.c.q!)) best = { o, g, c }
      })
    if (!tested) return `No group has ${d.min_group} nights in this range to compare.`
    if (!best) return `None of the ${tested} differences against nights ${refNights(e)} pass the false discovery threshold in this range.`
    const { o, g, c } = best as { o: ExposureOutcome; g: number; c: GroupCell }
    const m = def(registry, o.key)
    const words = NIGHTS_AFTER[e.key]
    const after = words ? `after ${words.subject} ${words.groups[g]}` : (yesNo(e)?.after ?? `in “${e.groups[g].label}”`)
    const ref = o.cells[0]
    return `${o.label} was ${moved(m, c.diff!)} on nights ${after} than on nights ${refNights(e)} (95% CI ${formatDelta(m, c.ci_lo!)} to ${formatDelta(m, c.ci_hi!)}, ${formatQ(c.q)}; ${c.n} and ${ref.n} nights).`
  }
  const rows = d.outcomes.filter((o) => isNum(o.correlation?.rho))
  if (!rows.length) return `Fewer than ${d.min_paired} nights in this range have ${lower(e.label)} to correlate.`
  const hit = rows.filter((o) => sig(o.correlation!.q)).sort((a, b) => a.correlation!.q! - b.correlation!.q!)[0]
  if (!hit) return `None of the ${rows.length} night measures moved with ${lower(e.label)} past the false discovery threshold in this range.`
  const c = hit.correlation!
  return `${hit.label} tended to ${c.rho! > 0 ? 'rise' : 'fall'} with more ${lower(e.label)} (ρ = ${formatRho(c.rho)}, ${formatQ(c.q)}, n = ${c.n} nights).`
}

export function BeforeNightFigure({ range, registry }: { range: Range; registry: Registry }) {
  const [picked, setPicked] = useState<string | null>(null)
  const q = useExposures(range, picked)
  const d = q.data
  if (!d) return <FigureSkeleton height={420} />
  const e = d.catalogue.find((x) => x.key === d.key)!
  const ready = e.available && d.nights.length > 0
  const cats = e.kind === 'groups' ? e.groups : []
  return (
    <Figure
      index={INDEX}
      title={TITLE}
      caption="What the day held, set against how that night went. Each panel is one measure of the night; pick what to look back at."
      reading={ready ? reading(e, d, registry) : undefined}
      legend={
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={d.key}
              onChange={setPicked}
              options={d.catalogue.filter((x) => x.source === 'watch').map((x) => ({ value: x.key, label: x.label }))}
              label="Exposure from the watch"
              size="sm"
            />
            <Select
              value={e.source === 'watch' ? null : d.key}
              onChange={setPicked}
              options={d.catalogue.flatMap((x) => (x.source === 'watch' ? [] : [{ value: x.key, label: x.label, group: MENU_GROUPS[x.source] }]))}
              label="Exposure from your journal or Health logs"
              placeholder="Journal or Health logs"
              size="sm"
            />
          </div>
          {ready && (
            <Legend
              items={
                e.kind === 'groups'
                  ? [
                      { label: e.groups[0].label, color: REF, kind: 'dot' },
                      { label: 'Night', color: DOT, kind: 'dot' },
                      { label: 'Median', color: SIGNAL.ink, kind: 'line' },
                      { label: 'FDR q < 0.05', color: SIGNAL.ink, kind: 'dot' },
                    ]
                  : [
                      { label: 'Night', color: DOT, kind: 'dot' },
                      { label: 'Binned median', color: TREND, kind: 'line' },
                      { label: 'FDR q < 0.05', color: SIGNAL.ink, kind: 'dot' },
                    ]
              }
            />
          )}
        </div>
      }
      method={exposureNote(e, d)}
      fetching={q.isPlaceholderData}
    >
      {!e.available ? (
        <EmptyState title="Not available">{e.reason}</EmptyState>
      ) : !d.nights.length ? (
        <EmptyState title="Nothing to draw">No nights in this range.</EmptyState>
      ) : (
        <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {d.outcomes.map((o) => {
            const m = def(registry, o.key)
            const pts = points(d, o.key)
            const c = o.correlation
            return (
              <section key={o.key} className="min-w-0">
                <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-hairline pb-1.5">
                  <div className="min-w-0 truncate text-[12.5px] text-ink-2">
                    {o.label}
                    {unitSuffix(m) && <span className="ml-1.5 text-ink-3">{unitSuffix(m)}</span>}
                  </div>
                  {c && (
                    <div className="num flex shrink-0 items-center gap-1.5 text-[12px] whitespace-nowrap text-ink">
                      <span className="text-ink-3">n {c.n}</span>
                      {sig(c.q) && <span className="ml-1 inline-block size-1.5 rounded-full bg-ink" aria-label="FDR q < 0.05" />}
                      <span className={sig(c.q) ? '' : 'ml-1'}>ρ {formatRho(c.rho)}</span>
                    </div>
                  )}
                </div>
                {e.kind === 'groups' ? (
                  <GroupStrips pts={pts} cells={o.cells} groups={cats} def={m} />
                ) : (
                  <ExposureScatter pts={pts} def={m} exposure={e} n={c?.n ?? 0} min={d.min_paired} />
                )}
              </section>
            )
          })}
        </div>
      )}
    </Figure>
  )
}

function points(d: Exposures, key: string): Pt[] {
  const ys = d.columns[key] ?? []
  const out: Pt[] = []
  d.nights.forEach((day, i) => {
    const x = d.exposure[i]
    const y = ys[i]
    if (isNum(x) && isNum(y)) out.push({ day, x, y })
  })
  return out
}

function yScale(pts: readonly Pt[], h: number): ScaleLinear<number, number> {
  return scaleLinear()
    .domain(robustDomain(pts.map((p) => p.y)))
    .range([h, 0])
    .nice(4)
    .clamp(true)
}

const fmtValue = (d: MetricDef, v: number) => (d.clock ? clock(v) : `${formatMetric(d, v)} ${unitSuffix(d)}`.trim())

/** The night nearest the pointer within 14 px, for the hover card. */
function nearest<T extends { cx: number; cy: number }>(items: readonly T[], px: number, py: number): T | null {
  let best: T | null = null
  let bestD = 14 * 14
  for (const it of items) {
    const dd = (it.cx - px) ** 2 + (it.cy - py) ** 2
    if (dd < bestD) {
      bestD = dd
      best = it
    }
  }
  return best
}

/** A CI bound without its unit so it fits under a strip: minutes for durations and clock times, the panel's unit otherwise. */
function bound(d: MetricDef, v: number) {
  const minutes = d.clock || d.unit === 'h' ? v * 60 : v
  const digits = d.clock || d.unit === 'h' || d.unit === 'min' ? 0 : d.decimals
  const r = Number(minutes.toFixed(digits))
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${fixed(Math.abs(r), digits)}`
}

/** Clock axes tick on whole multiples of four or six hours so they land on familiar times; other axes take three round ticks. */
function axisTicks(d: MetricDef, s: ScaleLinear<number, number>): number[] {
  if (!d.clock) return s.ticks(3)
  const [lo, hi] = s.domain()
  const [a, b] = s.range()
  const step = Math.abs(b - a) < 220 ? 6 : 4
  const out: number[] = []
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(t)
  return out
}

const ROW_H = 30
const LABEL_W = 42
const STAT_W = 74
const AXIS_H = 20

/** One row per group: nights along the outcome's axis, the median as a tick, and the difference from the reference at the right. */
function GroupStrips({ pts, cells, groups, def: m }: { pts: readonly Pt[]; cells: readonly GroupCell[]; groups: Exposure['groups']; def: MetricDef }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<(Pt & { cx: number; cy: number }) | null>(null)
  const plotW = Math.max(0, width - LABEL_W - STAT_W - 14)
  const plotH = groups.length * ROW_H
  const height = M.top + plotH + AXIS_H

  const { x, placed } = useMemo(() => {
    const sx = scaleLinear()
      .domain(robustDomain(pts.map((p) => p.y)))
      .range([0, plotW])
      .nice(3)
      .clamp(true)
    // A fixed golden-ratio jitter keeps every night in the same place across renders.
    const out = pts.map((p, i) => ({ ...p, cx: sx(p.y), cy: (p.x + 0.5) * ROW_H + (((i * 0.618034) % 1) - 0.5) * ROW_H * 0.55 }))
    return { x: sx, placed: out }
  }, [pts, plotW])
  const fx = tickFormat(m, x)
  const refMed = cells[0]?.median

  return (
    <div ref={ref} className="relative" style={{ height }} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${m.label} by group`}>
          <g transform={`translate(0,${M.top})`}>
            {groups.map((g, k) => {
              const c = cells[k]
              const est = k > 0 && isNum(c?.diff)
              const cy = k * ROW_H + ROW_H / 2
              return (
                <g key={g.label}>
                  <text x={0} y={cy - 2} fontSize={AX.font + 0.5} fill={AX.labelStrong}>
                    {g.short}
                  </text>
                  <text x={0} y={cy + 10} fontSize={AX.font - 1} fill={SIGNAL.ink4} className="num">
                    n {c?.n ?? 0}
                  </text>
                  <g transform={`translate(${width - STAT_W},0)`} fontSize={AX.font}>
                    {k === 0 ? (
                      <text y={cy + 3} fill={AX.label}>
                        reference
                      </text>
                    ) : est ? (
                      <>
                        {sig(c.q) && <circle cx={-6} cy={cy - 5.5} r={1.8} fill={SIGNAL.ink} />}
                        <text y={cy - 2} fill={sig(c.q) ? SIGNAL.ink : AX.labelStrong} className="num">
                          {formatDelta(m, c.diff!)}
                        </text>
                        <text y={cy + 10} fill={AX.label} fontSize={AX.font - 1} className="num">
                          [{bound(m, c.ci_lo!)}, {bound(m, c.ci_hi!)}]
                        </text>
                      </>
                    ) : (
                      <text y={cy + 3} fill={SIGNAL.ink4}>
                        too few
                      </text>
                    )}
                  </g>
                </g>
              )
            })}
            <g transform={`translate(${LABEL_W},0)`}>
              {axisTicks(m, x).map((t) => (
                <g key={t} transform={`translate(${x(t)},0)`}>
                  <line y1={0} y2={plotH} stroke={AX.grid} />
                  <line y1={plotH} y2={plotH + 4} stroke={AX.rule} />
                  <text y={plotH + 15} textAnchor="middle" fontSize={AX.font} fill={AX.label}>
                    {fx(t)}
                  </text>
                </g>
              ))}
              {isNum(refMed) && <line x1={x(refMed)} x2={x(refMed)} y1={0} y2={plotH} stroke={AX.rule} strokeDasharray="2 3" />}
              {placed.map((p) => (
                <circle key={p.day} cx={p.cx} cy={p.cy} r={R} fill={withAlpha(p.x === 0 ? REF : DOT, 0.5)} />
              ))}
              {cells.map(
                (c, k) =>
                  isNum(c.median) && (
                    <line key={k} x1={x(c.median)} x2={x(c.median)} y1={k * ROW_H + 4} y2={(k + 1) * ROW_H - 4} stroke={SIGNAL.ink} strokeWidth={2} strokeLinecap="round" />
                  ),
              )}
              {hover && <circle cx={hover.cx} cy={hover.cy} r={R + 1.5} fill={hover.x === 0 ? REF : DOT} stroke={SIGNAL.ink} strokeWidth={1.5} pointerEvents="none" />}
              <rect
                width={plotW}
                height={plotH}
                fill="transparent"
                onPointerMove={(ev) => {
                  const b = ev.currentTarget.getBoundingClientRect()
                  setHover(nearest(placed, ev.clientX - b.left, ev.clientY - b.top))
                }}
              />
            </g>
          </g>
        </svg>
      )}
      {hover && (
        <HoverCard
          x={LABEL_W + hover.cx}
          y={M.top + hover.cy}
          containerW={width}
          title={formatDate(hover.day, { weekday: true, year: true })}
          rows={[{ label: groups[hover.x]?.label ?? '', value: fmtValue(m, hover.y), color: hover.x === 0 ? REF : DOT, kind: 'dot' }]}
        />
      )}
    </div>
  )
}

const SCATTER_BOTTOM = 30

function ExposureScatter({ pts, def: m, exposure, n, min }: { pts: readonly Pt[]; def: MetricDef; exposure: Exposure; n: number; min: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<(Pt & { cx: number; cy: number }) | null>(null)
  const innerW = Math.max(0, width - M.left - M.right)
  const height = M.top + PLOT_H + SCATTER_BOTTOM
  const color = DOT

  const { x, y, placed, trend } = useMemo(() => {
    const sx = scaleLinear()
      .domain(robustDomain(pts.map((p) => p.x)))
      .range([0, innerW])
      .nice(4)
      .clamp(true)
    const sy = yScale(pts, PLOT_H)
    const ln = line<{ x: number; y: number }>()
      .x((p) => sx(p.x))
      .y((p) => sy(p.y))
    return { x: sx, y: sy, placed: pts.map((p) => ({ ...p, cx: sx(p.x), cy: sy(p.y) })), trend: ln(binnedMedian(pts)) ?? '' }
  }, [pts, innerW])
  const fy = tickFormat(m, y)
  const unit = exposure.unit === 'min' ? 'm' : exposure.unit

  return (
    <div ref={ref} className="relative" style={{ height }} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${m.label} against ${exposure.label}`}>
          <g transform={`translate(${M.left},${M.top})`}>
            <ValueAxis ticks={y.ticks(4)} y={y} x={0} width={innerW} format={fy} />
            {x.ticks(4).map((t) => (
              <g key={t} transform={`translate(${x(t)},0)`}>
                <line y1={PLOT_H} y2={PLOT_H + 4} stroke={AX.rule} />
                <text y={PLOT_H + 15} textAnchor="middle" fontSize={AX.font} fill={AX.label}>
                  {t}
                  {unit}
                </text>
              </g>
            ))}
            {placed.map((p) => (
              <circle key={p.day} cx={p.cx} cy={p.cy} r={R} fill={withAlpha(color, 0.55)} />
            ))}
            {trend && <path d={trend} fill="none" stroke={TREND} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />}
            {n < min && (
              <text x={innerW / 2} y={PLOT_H / 2} textAnchor="middle" fontSize={AX.font + 1} fill={AX.label}>
                {n} of {min} nights needed
              </text>
            )}
            {hover && <circle cx={hover.cx} cy={hover.cy} r={R + 1.5} fill={color} stroke={SIGNAL.ink} strokeWidth={1.5} pointerEvents="none" />}
            <rect
              width={innerW}
              height={PLOT_H}
              fill="transparent"
              onPointerMove={(ev) => {
                const b = ev.currentTarget.getBoundingClientRect()
                setHover(nearest(placed, ev.clientX - b.left, ev.clientY - b.top))
              }}
            />
          </g>
        </svg>
      )}
      {hover && (
        <HoverCard
          x={M.left + hover.cx}
          y={M.top + hover.cy}
          containerW={width}
          title={formatDate(hover.day, { weekday: true, year: true })}
          rows={[
            { label: exposure.label, value: `${Math.round(hover.x)} ${exposure.unit}`.trim() },
            { label: m.label, value: fmtValue(m, hover.y), color, kind: 'dot' },
          ]}
        />
      )}
    </div>
  )
}

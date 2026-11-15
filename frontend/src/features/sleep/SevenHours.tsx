import { line } from 'd3-shape'
import { scaleLinear } from 'd3-scale'
import { useObservatory } from '@/app/context'
import { SIGNAL } from '@/core/color'
import type { SevenHours as SevenHoursData } from '@/core/domain'
import { fixed } from '@/core/format'
import { isNum } from '@/core/stats'
import type { IsoDate } from '@/core/time'
import { useSevenHours } from '@/infra/queries'
import { WeekBars } from '@/features/fitness/WeekBars'
import { BandChart } from '@/ui/charts/BandChart'
import { Figure } from '@/ui/charts/Figure'
import { EmptyState } from '@/ui/primitives'
import { loadable } from './data'
import { Frame, PanelLabel } from './Frame'

const MET = SIGNAL.core
const SHORT = SIGNAL.awake
/** The shortfall is a sum of hours, not a stretch of time, so it reads as decimal hours. */
const hours = (v: number | null | undefined) => (v == null ? '—' : `${fixed(v, 1)} h`)

export function SevenHours() {
  const { range } = useObservatory()
  const state = loadable(useSevenHours(range))
  return <Frame state={state} height={420}>{(d, fetching) => <SevenHoursFigure data={d} fetching={fetching} />}</Frame>
}

function SevenHoursFigure({ data, fetching }: { data: SevenHoursData; fetching: boolean }) {
  const any = data.share != null
  const floor = fixed(data.floor_h)
  const label = `Hours short of seven over ${data.shortfall_nights} nights`
  return (
    <Figure
      index="2.8"
      title="Nights of seven hours or more"
      caption={`The share of each week’s nights with at least ${floor} h of total sleep. Below, the hours short of ${floor} h added up over the last ${data.shortfall_nights} recorded nights.`}
      reading={
        any ? (
          <>
            <b className="num">{fixed(data.share)}%</b> of nights in this range had {floor} hours or more; the {data.shortfall_nights}-night shortfall had a median of{' '}
            <b className="num">{hours(data.shortfall_median)}</b>.
          </>
        ) : undefined
      }
      method={{
        body: (
          <>
            <p>
              A night counts when its main episode holds at least {floor} h staged Core, REM or Deep. Each week runs Monday to Sunday; the share is of the nights recorded that
              week, so a week with three recorded nights out of seven is a share of three.
            </p>
            <p>
              The shortfall line adds, for each recorded night, max(0, {floor} h − total sleep) over that night and the {data.shortfall_nights - 1} recorded nights before it.
              Nights above {floor} h do not pay back nights below it. It needs {data.shortfall_nights} recorded nights before it shows.
            </p>
            <p>The {floor} h floor is the adult population recommendation from the AASM and Sleep Research Society consensus, not a measure of your own sleep need.</p>
          </>
        ),
        cite: 'Watson NF et al. Recommended amount of sleep for a healthy adult. Sleep 2015;38:843–844.',
      }}
      fetching={fetching}
    >
      {any ? (
        <div className="space-y-8">
          <WeekBars
            weeks={data.weeks}
            weekDays={data.week_days}
            stacks={[{ key: 'met', label: `Nights ≥ ${floor} h`, color: MET, values: data.week_share }]}
            domainMax={100}
            height={200}
            format={(v) => `${v}%`}
            label={`Share of nights with ${floor} hours or more, by week`}
            hover={(k) => ({
              rows: [
                { label: `nights ≥ ${floor} h`, value: data.week_share[k] == null ? '—' : `${fixed(data.week_share[k])}%`, color: MET, kind: 'swatch' },
                { label: 'nights recorded', value: fixed(data.week_nights[k]) },
              ],
            })}
          />
          <div className="min-w-0">
            <PanelLabel title={label} value={`median ${hours(data.shortfall_median)}`} />
            <ShortfallLine days={data.days} values={data.shortfall} label={label} />
          </div>
        </div>
      ) : (
        <EmptyState title="No nights to count">No main sleep episode falls inside the range.</EmptyState>
      )}
    </Figure>
  )
}

function ShortfallLine({ days, values, label }: { days: readonly IsoDate[]; values: readonly (number | null)[]; label: string }) {
  const top = Math.max(1, ...values.filter(isNum))
  const domain = scaleLinear().domain([0, top]).nice(4).domain() as [number, number]
  return (
    <BandChart
      days={days}
      series={[{ key: 'shortfall', label: 'hours short of seven', color: SHORT, values, window: 0 }]}
      height={160}
      domain={domain}
      ticks={4}
      format={(v) => `${v}h`}
      valueFormat={hours}
      margin={{ top: 10, right: 14, bottom: 26, left: 48 }}
      label={label}
      annotate={({ x, y }) => {
        const pts = values.flatMap((v, i) => (isNum(v) ? [[x(i), y(v)] as [number, number]] : []))
        return <path d={line()(pts) ?? ''} fill="none" stroke={SHORT} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />
      }}
    />
  )
}

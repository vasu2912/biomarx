import type { ReactNode } from 'react'
import type { IsoDate } from '@/core/time'
import { BandChart, type BandSeriesSpec } from '@/ui/charts/BandChart'
import { Legend, type LegendItem } from '@/ui/charts/Figure'
import { cn } from '@/ui/primitives'

/** One small multiple: a single y-axis, one unit, one or more series sharing it. */
export interface PanelSpec {
  key: string
  title: string
  unit?: string
  stat?: ReactNode
  legend?: LegendItem[]
  series: BandSeriesSpec[]
  format: (v: number) => string
  valueFormat?: (v: number | null) => string
  domain?: [number, number]
  ticks?: number | number[]
}

const COLS = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' } as const

export function Panels({ days, panels, cols, height = 170 }: { days: readonly IsoDate[]; panels: readonly PanelSpec[]; cols: keyof typeof COLS; height?: number }) {
  return (
    <div className={cn('grid gap-x-8 gap-y-10 sm:grid-cols-2', COLS[cols])}>
      {panels.map((p) => (
        <section key={p.key} className="min-w-0">
          <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-hairline pb-1.5">
            <div className="text-[12.5px] text-ink-2">
              {p.title}
              {p.unit && <span className="ml-1.5 text-ink-3">{p.unit}</span>}
            </div>
            {p.stat && <div className="num text-[12px] text-ink">{p.stat}</div>}
          </div>
          {p.legend && <Legend items={p.legend} className="mb-1.5 !text-[11px]" />}
          <BandChart
            days={days}
            series={p.series}
            height={height}
            format={p.format}
            valueFormat={p.valueFormat}
            domain={p.domain}
            ticks={p.ticks}
            label={p.title}
          />
        </section>
      ))}
    </div>
  )
}

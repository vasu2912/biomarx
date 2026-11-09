import type { ReactNode } from 'react'
import { LegendKey } from './Figure'

export interface HoverRow {
  label: string
  value: string
  color?: string
  kind?: 'line' | 'swatch' | 'dot'
  sub?: string
}

/** Positioned inside the chart's relative container; flips to the left of the pointer near the right edge. */
export function HoverCard({ x, y, containerW, title, rows, footer }: { x: number; y: number; containerW: number; title: ReactNode; rows: HoverRow[]; footer?: ReactNode }) {
  const flip = x > containerW - 220
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-20 min-w-44 rounded-md border border-hairline-2 bg-raised/95 px-3 py-2.5 shadow-2xl shadow-black/50 backdrop-blur-sm"
      style={{ left: flip ? undefined : x + 14, right: flip ? containerW - x + 14 : undefined, top: Math.max(0, y - 10) }}
    >
      <div className="num mb-1.5 text-[10.5px] tracking-wide text-ink-3 uppercase">{title}</div>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2 text-[12px]">
            {r.color && <LegendKey color={r.color} kind={r.kind ?? 'line'} />}
            <span className="num font-medium text-ink">{r.value}</span>
            <span className="truncate text-ink-3">{r.label}</span>
            {r.sub && <span className="num ml-auto pl-2 text-[11px] text-ink-3">{r.sub}</span>}
          </div>
        ))}
      </div>
      {footer && <div className="mt-2 border-t border-hairline pt-1.5 text-[11px] text-ink-3">{footer}</div>}
    </div>
  )
}

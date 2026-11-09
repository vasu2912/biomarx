import { motion, useReducedMotion } from 'motion/react'
import { Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn, IconButton, Popover } from '../primitives'

export interface MethodNote {
  body: ReactNode
  cite?: string
}

export function Figure({
  index,
  title,
  caption,
  reading,
  legend,
  method,
  children,
  className,
  fetching,
  id,
}: {
  index: string
  title: ReactNode
  caption?: ReactNode
  reading?: ReactNode
  legend?: ReactNode
  method?: MethodNote
  children: ReactNode
  className?: string
  /** Refetch in flight: hold the previous render, dimmed, rather than flashing a skeleton. */
  fetching?: boolean
  id?: string
}) {
  const reduced = useReducedMotion()
  return (
    <motion.figure
      id={id}
      data-figure={index}
      initial={reduced ? false : { opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className={cn('group/fig relative min-w-0', className)}
    >
      <header className="mb-4">
        <div className="mb-2.5 flex items-center gap-3">
          <span className="eyebrow !text-ink-3">Fig. {index}</span>
          <span className="h-px flex-1 bg-hairline" />
          {method && (
            <Popover
              trigger={
                <IconButton label="About this method" className="-my-1">
                  <Info size={14} />
                </IconButton>
              }
            >
              <div className="eyebrow mb-2">Method</div>
              <div className="space-y-2 text-ink-2">{method.body}</div>
              {method.cite && <div className="mt-3 border-t border-hairline pt-2.5 text-[11.5px] text-ink-3 italic">{method.cite}</div>}
            </Popover>
          )}
        </div>
        <h3 className="display text-[23px] leading-[1.15] text-ink">{title}</h3>
        {caption && <p className="mt-1.5 max-w-[72ch] text-[13px] leading-relaxed text-ink-3">{caption}</p>}
        {reading && (
          <p className="mt-3 flex max-w-[80ch] items-baseline gap-2.5 text-[14px] leading-snug text-ink">
            <span aria-hidden className="relative top-[-2px] inline-block h-px w-5 shrink-0 bg-sun" />
            <span>{reading}</span>
          </p>
        )}
        {legend && <div className="mt-3.5">{legend}</div>}
      </header>
      <div className={cn('transition-opacity duration-300', fetching && 'opacity-50')}>{children}</div>
    </motion.figure>
  )
}

export type LegendItem = { label: string; color: string; kind?: 'swatch' | 'line' | 'dot' | 'band'; dim?: boolean }

export function Legend({ items, className }: { items: readonly LegendItem[]; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-ink-2', className)}>
      {items.map((it) => (
        <li key={it.label} className={cn('flex items-center gap-1.5', it.dim && 'opacity-60')}>
          <LegendKey color={it.color} kind={it.kind ?? 'swatch'} />
          {it.label}
        </li>
      ))}
    </ul>
  )
}

export function LegendKey({ color, kind }: { color: string; kind: NonNullable<LegendItem['kind']> }) {
  if (kind === 'line') return <span className="inline-block h-[2px] w-3.5 rounded-full" style={{ background: color }} />
  if (kind === 'dot') return <span className="inline-block size-2 rounded-full" style={{ background: color }} />
  if (kind === 'band')
    return (
      <span className="relative inline-block h-2.5 w-4 rounded-[2px]" style={{ background: `color-mix(in oklab, ${color} 22%, transparent)` }}>
        <span className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full" style={{ background: color }} />
      </span>
    )
  return <span className="inline-block size-2.5 rounded-[2px]" style={{ background: color }} />
}

/** A continuous color legend: the ramp as a thin bar with end and mid labels. */
export function RampLegend({ ramp, ticks, label, width = 160 }: { ramp: (t: number) => string; ticks: { at: number; label: string }[]; label: string; width?: number }) {
  const stops = Array.from({ length: 11 }, (_, i) => `${ramp(i / 10)} ${i * 10}%`).join(',')
  return (
    <div className="flex items-center gap-3 text-[11px] text-ink-3">
      <span className="text-ink-2">{label}</span>
      <div style={{ width }}>
        <div className="h-1.5 rounded-full" style={{ background: `linear-gradient(90deg, ${stops})` }} />
        <div className="num relative mt-1 h-3">
          {ticks.map((t) => (
            <span key={t.label} className="absolute -translate-x-1/2 text-[10px]" style={{ left: `${t.at * 100}%` }}>
              {t.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

export function FigureSkeleton({ height = 320 }: { height?: number }) {
  return (
    <div className="space-y-3">
      <div className="h-3 w-24 animate-pulse rounded bg-white/[0.04]" />
      <div className="h-6 w-80 animate-pulse rounded bg-white/[0.05]" />
      <div className="animate-pulse rounded-md bg-white/[0.025]" style={{ height }} />
    </div>
  )
}

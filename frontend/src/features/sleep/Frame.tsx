import type { ReactNode } from 'react'
import { FigureSkeleton } from '@/ui/charts/Figure'
import { EmptyState } from '@/ui/primitives'
import type { Loadable } from './data'

/** Skeleton while the first frame loads, a plain reason on failure, the figure otherwise. */
export function Frame<T>({ state, height, children }: { state: Loadable<T>; height: number; children: (data: T, fetching: boolean) => ReactNode }) {
  if (state.kind === 'loading') return <FigureSkeleton height={height} />
  if (state.kind === 'error') return <EmptyState title="Could not load this figure">The API request failed. Reload to try again.</EmptyState>
  return <>{children(state.data, state.fetching)}</>
}

export function PanelLabel({ title, value }: { title: string; value?: string }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12px]">
      <span className="text-ink-2">{title}</span>
      {value && <span className="num text-ink-3">{value}</span>}
    </div>
  )
}

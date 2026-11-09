import { createContext, use } from 'react'
import type { Dataset, Range } from '@/core/domain'
import type { Registry } from '@/core/metrics'

export interface Observatory {
  dataset: Dataset
  registry: Registry
  span: Range
  range: Range
  /** equal-length period before `range`, for deltas; null at the start of the data */
  prev: Range | null
}

export const ObservatoryContext = createContext<Observatory | null>(null)

export function useObservatory(): Observatory {
  const v = use(ObservatoryContext)
  if (!v) throw new Error('useObservatory outside a loaded dataset')
  return v
}

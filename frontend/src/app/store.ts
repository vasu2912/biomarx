import { create } from 'zustand'
import type { Dataset, Range } from '@/core/domain'
import { DEFAULT_SELECTION, resolveRange, type RangeSelection } from '@/core/range'
import type { IsoDate } from '@/core/time'

interface UiState {
  selection: RangeSelection
  /** Day under the pointer in any day-indexed chart on the current page. */
  hoverDay: IsoDate | null
  setSelection: (s: RangeSelection) => void
  setHoverDay: (d: IsoDate | null) => void
}

export const useUi = create<UiState>((set) => ({
  selection: DEFAULT_SELECTION,
  hoverDay: null,
  setSelection: (selection) => set({ selection }),
  setHoverDay: (hoverDay) => set((s) => (s.hoverDay === hoverDay ? s : { hoverDay })),
}))

export const spanOf = (d: Dataset): Range => ({ start: d.start, end: d.end })

export function useResolvedRange(dataset: Dataset): Range {
  const selection = useUi((s) => s.selection)
  const r = resolveRange(selection, spanOf(dataset))
  return stable(r)
}

let last: Range | null = null
function stable(r: Range): Range {
  if (last && last.start === r.start && last.end === r.end) return last
  last = r
  return r
}

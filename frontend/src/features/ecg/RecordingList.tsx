import { RadioGroup } from 'radix-ui'
import type { EcgSummary } from '@/core/domain'
import { fixed } from '@/core/format'
import { Badge, cn } from '@/ui/primitives'
import { classTone, recordedLabel } from './model'

const COLUMNS = [
  { label: 'Recorded', align: 'left', cell: (r: EcgSummary) => recordedLabel(r.recorded_at) },
  { label: 'Classification', align: 'left', cell: (r: EcgSummary) => <Badge tone={classTone(r.classification)}>{r.classification}</Badge> },
  { label: 'Mean HR', align: 'right', cell: (r: EcgSummary) => `${fixed(r.mean_hr, 1)} bpm` },
  { label: 'RMSSD', align: 'right', cell: (r: EcgSummary) => `${fixed(r.rmssd, 1)} ms` },
  { label: 'Duration', align: 'right', cell: (r: EcgSummary) => `${fixed(r.duration_s)} s` },
] as const

const GRID = 'grid grid-cols-[minmax(150px,1.4fr)_minmax(130px,1.2fr)_repeat(3,minmax(80px,0.7fr))] items-center gap-x-4 px-3'

/** Arrow keys move the selection (Radix radio group roving focus). */
export function RecordingList({ items, value, onChange }: { items: readonly EcgSummary[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className={cn(GRID, 'eyebrow h-8 border-b border-hairline !text-ink-3')}>
          {COLUMNS.map((c) => (
            <span key={c.label} className={c.align === 'right' ? 'text-right' : undefined}>
              {c.label}
            </span>
          ))}
        </div>
        <RadioGroup.Root value={value} onValueChange={onChange} aria-label="ECG recordings" loop>
          {items.map((r) => (
            <RadioGroup.Item
              key={r.id}
              value={r.id}
              className={cn(
                GRID,
                'h-10 w-full border-b border-hairline text-left text-[12.5px] text-ink-2 transition-colors outline-none hover:bg-raised/60 focus-visible:bg-raised',
                'data-[state=checked]:bg-raised data-[state=checked]:text-ink data-[state=checked]:shadow-[inset_2px_0_0_var(--color-awake)]',
              )}
            >
              {COLUMNS.map((c) => (
                <span key={c.label} className={cn('num truncate', c.align === 'right' && 'text-right')}>
                  {c.cell(r)}
                </span>
              ))}
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
      </div>
    </div>
  )
}

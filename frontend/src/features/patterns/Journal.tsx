import { X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { SIGNAL, withAlpha } from '@/core/color'
import type { Journal, JournalDay, JournalTag, Range } from '@/core/domain'
import { addDays, dayRange, formatDate, monthLabel, weekday, WEEKDAYS, type IsoDate } from '@/core/time'
import { useAddJournalTag, useJournal, useSaveJournalDay } from '@/infra/queries'
import { Figure, FigureSkeleton, Legend, type LegendItem, type MethodNote } from '@/ui/charts/Figure'
import { Button, cn, IconButton } from '@/ui/primitives'

const INDEX = '5.5'
const MAX_MARKS = 3

/** Built-in tags keep one color each; tags of your own take the rest of the palette in the order you added them. */
const TAG_COLOR: Record<string, string> = {
  alcohol: SIGNAL.hrv,
  late_meal: SIGNAL.sun,
  caffeine_pm: SIGNAL.ember,
  sauna: SIGNAL.awake,
  cold: SIGNAL.spo2,
  illness: SIGNAL.resp,
  travel: SIGNAL.rem,
  stress: SIGNAL.cool,
}
const CUSTOM_COLORS = [SIGNAL.core, SIGNAL.onset, SIGNAL.ink2]
const REVIEWED = withAlpha(SIGNAL.ink, 0.07)

function tagColors(tags: readonly JournalTag[]): Record<string, string> {
  const out: Record<string, string> = { ...TAG_COLOR }
  tags.filter((t) => t.custom).forEach((t, i) => (out[t.key] = CUSTOM_COLORS[i % CUSTOM_COLORS.length]))
  return out
}

/** The person’s own calendar day; the server refuses days after it. */
function localToday(): IsoDate {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const METHOD: MethodNote = {
  body: (
    <>
      <p>
        Tags are your own record of what the export can’t see. A day you open and mark, with a tag or with nothing to note, counts as reviewed; a day you never opened says nothing
        either way.
      </p>
      <p>
        Fig. 5.4 sets the night after each reviewed day against the others: nights after a tagged day against nights after a reviewed day without the tag. A comparison needs at
        least 5 tagged and 5 untagged reviewed nights, and uses the same medians, bootstrap intervals and Mann–Whitney tests as the rest of that figure.
      </p>
      <p>These are associations within one person, not causes.</p>
    </>
  ),
  cite: 'Benjamini Y, Hochberg Y. J R Stat Soc B 1995;57:289–300.',
}

function reading(j: Journal, days: number) {
  if (!j.days.length) return `None of the ${days} days in this range is in your journal yet. Pick a day to note what it held.`
  const counts = new Map<string, number>()
  for (const d of j.days) for (const t of d.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
  const top = [...counts].sort((a, b) => b[1] - a[1])[0]
  const reviewed = `${j.days.length} of ${days} days in this range are reviewed`
  if (!top) return `${reviewed}, none of them tagged.`
  const label = j.tags.find((t) => t.key === top[0])?.label ?? top[0]
  return `${reviewed}; the most frequent tag is ${label}, on ${top[1]} ${top[1] === 1 ? 'day' : 'days'}.`
}

export function JournalFigure({ range }: { range: Range }) {
  const q = useJournal(range)
  const j = q.data
  const days = useMemo(() => {
    const today = localToday()
    return dayRange(range.start, range.end).filter((d) => d <= today)
  }, [range.start, range.end])
  if (!j) return <FigureSkeleton height={300} />
  const colors = tagColors(j.tags)
  const used = new Set(j.days.flatMap((d) => d.tags))
  const legend: LegendItem[] = [
    ...j.tags.filter((t) => used.has(t.key)).map((t) => ({ label: t.label, color: colors[t.key], kind: 'dot' as const })),
    { label: 'Reviewed', color: withAlpha(SIGNAL.ink, 0.16), kind: 'swatch' },
  ]
  return (
    <Figure
      index={INDEX}
      title="Journal"
      caption="What the export can’t record: your own note of each day. Pick a day to tag it, or mark it as having nothing to note. Fig. 5.4 compares the nights after."
      reading={reading(j, days.length)}
      legend={<Legend items={legend} />}
      method={METHOD}
      fetching={q.isPlaceholderData}
    >
      <Calendar journal={j} days={days} colors={colors} />
    </Figure>
  )
}

type Month = { key: string; first: IsoDate; cells: (IsoDate | null)[] }

/** Each month as weeks of Monday to Sunday; days outside the range keep their place but stay blank. */
function months(days: readonly IsoDate[]): Month[] {
  const inRange = new Set(days)
  const out: Month[] = []
  for (const d of days) {
    const key = d.slice(0, 7)
    if (out[out.length - 1]?.key === key) continue
    const first = `${key}-01`
    const cells: (IsoDate | null)[] = Array.from({ length: weekday(first) }, () => null)
    for (let x = first; x.slice(0, 7) === key; x = addDays(x, 1)) cells.push(inRange.has(x) ? x : null)
    out.push({ key, first, cells })
  }
  return out
}

const STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }

function Calendar({ journal, days, colors }: { journal: Journal; days: readonly IsoDate[]; colors: Record<string, string> }) {
  const [open, setOpen] = useState<IsoDate | null>(null)
  const [focus, setFocus] = useState<IsoDate | null>(null)
  const cells = useRef(new Map<IsoDate, HTMLButtonElement>())
  const entries = useMemo(() => new Map(journal.days.map((d) => [d.date, d])), [journal.days])
  const grid = useMemo(() => months(days), [days])
  const current = focus && days.includes(focus) ? focus : (open ?? days[days.length - 1])

  const moveTo = (d: IsoDate) => {
    const target = d < days[0] ? days[0] : d > days[days.length - 1] ? days[days.length - 1] : d
    setFocus(target)
    cells.current.get(target)?.focus()
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (!current) return
    if (STEP[e.key]) moveTo(addDays(current, STEP[e.key]))
    else if (e.key === 'Home') moveTo(days[0])
    else if (e.key === 'End') moveTo(days[days.length - 1])
    else return
    e.preventDefault()
  }
  const close = () => {
    const d = open
    setOpen(null)
    if (d) cells.current.get(d)?.focus()
  }

  return (
    <div>
      <div role="group" aria-label="Journal calendar; arrow keys move between days" onKeyDown={onKey} className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-4 gap-y-5">
        {grid.map((m, i) => (
          <div key={m.key} className="min-w-0">
            <div className="num mb-1.5 text-[11px] text-ink-2">{monthLabel(m.first, i === 0 || m.first.endsWith('-01-01'))}</div>
            <div className="grid grid-cols-7 gap-[3px]">
              {WEEKDAYS.map((w, k) => (
                <div key={k} aria-hidden className="num text-center text-[9px] text-ink-4">
                  {w[0]}
                </div>
              ))}
              {m.cells.map((d, k) =>
                d ? (
                  <DayCell
                    key={d}
                    day={d}
                    entry={entries.get(d)}
                    colors={colors}
                    tags={journal.tags}
                    selected={open === d}
                    tabbable={current === d}
                    cellRef={(el) => (el ? cells.current.set(d, el) : cells.current.delete(d))}
                    onPick={() => {
                      setFocus(d)
                      setOpen(open === d ? null : d)
                    }}
                  />
                ) : (
                  <div key={`b${k}`} aria-hidden />
                ),
              )}
            </div>
          </div>
        ))}
      </div>
      {open && <Editor key={open} day={open} entry={entries.get(open)} journal={journal} colors={colors} onClose={close} />}
    </div>
  )
}

function DayCell({
  day,
  entry,
  colors,
  tags,
  selected,
  tabbable,
  cellRef,
  onPick,
}: {
  day: IsoDate
  entry: JournalDay | undefined
  colors: Record<string, string>
  tags: readonly JournalTag[]
  selected: boolean
  tabbable: boolean
  cellRef: (el: HTMLButtonElement | null) => void
  onPick: () => void
}) {
  const names = entry?.tags.map((k) => tags.find((t) => t.key === k)?.label ?? k) ?? []
  const status = !entry ? 'not reviewed' : names.length ? names.join(', ') : 'nothing to note'
  return (
    <button
      ref={cellRef}
      type="button"
      tabIndex={tabbable ? 0 : -1}
      aria-expanded={selected}
      aria-label={`${formatDate(day, { weekday: true, year: true })}: ${status}`}
      title={`${formatDate(day, { weekday: true })} · ${status}`}
      onClick={onPick}
      className={cn(
        'flex h-[26px] min-w-0 flex-col items-center justify-start gap-[3px] rounded-[3px] pt-[3px] transition-colors hover:bg-white/[0.09]',
        selected && 'shadow-[inset_0_0_0_1px_var(--color-ink-3)]',
      )}
      style={{ background: entry ? REVIEWED : withAlpha(SIGNAL.ink, 0.018) }}
    >
      <span className={cn('num text-[9px] leading-none', entry ? 'text-ink-2' : 'text-ink-4')}>{Number(day.slice(8))}</span>
      <span className="flex h-1 items-center gap-[2px]">
        {entry?.tags.slice(0, MAX_MARKS).map((k) => <span key={k} className="size-1 rounded-full" style={{ background: colors[k] ?? SIGNAL.ink2 }} />)}
      </span>
    </button>
  )
}

const chip =
  'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] transition-colors select-none disabled:pointer-events-none disabled:opacity-40'
const chipOff = 'border-hairline bg-sunken text-ink-3 hover:text-ink'
const chipOn = 'border-hairline-2 bg-raised text-ink'

function Editor({
  day,
  entry,
  journal,
  colors,
  onClose,
}: {
  day: IsoDate
  entry: JournalDay | undefined
  journal: Journal
  colors: Record<string, string>
  onClose: () => void
}) {
  const save = useSaveJournalDay()
  const add = useAddJournalTag()
  const [label, setLabel] = useState('')
  const tags = entry?.tags ?? []
  const nothing = entry?.answered === true && tags.length === 0
  const own = journal.tags.filter((t) => t.custom).length

  const put = (next: string[], answered: boolean) => save.mutate({ date: day, tags: next, answered: answered || next.length > 0 })
  const toggle = (k: string) => {
    const next = tags.includes(k) ? tags.filter((t) => t !== k) : [...tags, k]
    // Taking off the last tag returns the day to unreviewed; “Nothing to note” is the explicit way to review a quiet day.
    put(next, false)
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = label.trim()
    if (!text) return
    add.mutate(text, {
      onSuccess: (t) => {
        setLabel('')
        if (!tags.includes(t.key)) put([...tags, t.key], true)
      },
    })
  }
  const error = save.error ?? add.error

  return (
    <section
      aria-label={`Journal for ${formatDate(day, { weekday: true, year: true })}`}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      className="mt-6 rounded-md border border-hairline bg-white/[0.015] px-5 py-4"
    >
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h4 className="display text-[17px] text-ink">{formatDate(day, { weekday: true, year: true })}</h4>
          <span className="num text-[11.5px] text-ink-3">{!entry ? 'Not reviewed' : nothing ? 'Nothing to note' : `${tags.length} ${tags.length === 1 ? 'tag' : 'tags'}`}</span>
        </div>
        <IconButton label="Close" onClick={onClose}>
          <X size={15} />
        </IconButton>
      </div>
      <div role="group" aria-label="Tags" className="flex flex-wrap items-center gap-1.5">
        {journal.tags.map((t) => {
          const on = tags.includes(t.key)
          return (
            <button key={t.key} type="button" aria-pressed={on} title={t.hint || undefined} onClick={() => toggle(t.key)} className={cn(chip, on ? chipOn : chipOff)}>
              <span className="size-2 rounded-full" style={{ background: on ? colors[t.key] : withAlpha(colors[t.key] ?? SIGNAL.ink2, 0.45) }} />
              {t.label}
              {t.hint && <span className="text-ink-4">{t.hint.toLowerCase()}</span>}
            </button>
          )
        })}
        <span aria-hidden className="mx-1.5 h-4 w-px bg-hairline-2" />
        <button type="button" aria-pressed={nothing} onClick={() => put([], !nothing)} className={cn(chip, nothing ? chipOn : chipOff)}>
          Nothing to note
        </button>
      </div>
      <form onSubmit={submit} className="mt-3 flex flex-wrap items-center gap-2">
        {own < journal.max_custom ? (
          <>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={journal.label_max}
              placeholder="A tag of your own"
              aria-label="A tag of your own"
              className="h-7 w-48 rounded-md border border-hairline-2 bg-sunken px-2.5 text-[12px] text-ink placeholder:text-ink-4 hover:border-ink-4"
            />
            <Button type="submit" className="!h-7 !px-3 !text-[12px]" disabled={!label.trim() || add.isPending}>
              Add
            </Button>
          </>
        ) : (
          <span className="text-[12px] text-ink-3">{journal.max_custom} tags of your own is the most the journal keeps.</span>
        )}
      </form>
      {error && <p className="mt-2 text-[12px] text-bad">Not saved: {error.message}</p>}
      <p className="mt-3 text-[11.5px] text-ink-3">Kept on this machine beside the database; a new import never replaces it.</p>
    </section>
  )
}

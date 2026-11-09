/** ISO calendar date, YYYY-MM-DD. All day math runs in UTC so wall-clock dates never shift. */
export type IsoDate = string

const DAY_MS = 86_400_000

export function parseDate(d: IsoDate): Date {
  return new Date(`${d}T00:00:00Z`)
}

export function toIso(d: Date): IsoDate {
  return d.toISOString().slice(0, 10)
}

export function addDays(d: IsoDate, n: number): IsoDate {
  return toIso(new Date(parseDate(d).getTime() + n * DAY_MS))
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / DAY_MS)
}

export function dayRange(start: IsoDate, end: IsoDate): IsoDate[] {
  const n = daysBetween(start, end)
  const out: IsoDate[] = []
  for (let i = 0; i < n; i++) out.push(addDays(start, i))
  return out
}

export function weekday(d: IsoDate): number {
  return (parseDate(d).getUTCDay() + 6) % 7
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function monthLabel(d: IsoDate, withYear = false): string {
  const dt = parseDate(d)
  const m = MONTHS[dt.getUTCMonth()]
  return withYear ? `${m} ${String(dt.getUTCFullYear())}` : m
}

export function formatDate(d: IsoDate, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const dt = parseDate(d)
  const parts = [`${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`]
  if (opts.year) parts.push(String(dt.getUTCFullYear()))
  const s = parts.join(' ')
  return opts.weekday ? `${WEEKDAYS[weekday(d)]} ${s}` : s
}

export function formatRange(start: IsoDate, endExclusive: IsoDate): string {
  const last = addDays(endExclusive, -1)
  const sameYear = start.slice(0, 4) === last.slice(0, 4)
  return `${formatDate(start, { year: !sameYear })} – ${formatDate(last, { year: true })}`
}

/** Clock hours, possibly beyond 24 or negative, to "HH:MM": 25.5 -> "01:30". */
export function clock(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h)) return '—'
  const total = Math.round((((h % 24) + 24) % 24) * 60) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Minutes to "7h 12m"; hours variant via durationH. */
export function duration(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return '—'
  const sign = min < 0 ? '−' : ''
  const m = Math.round(Math.abs(min))
  const h = Math.floor(m / 60)
  const r = m % 60
  return h ? `${sign}${h}h ${String(r).padStart(2, '0')}m` : `${sign}${r}m`
}

export const durationH = (h: number | null | undefined) => (h == null ? '—' : duration(h * 60))

export function hourTick(h: number): string {
  const v = ((h % 24) + 24) % 24
  return `${String(Math.floor(v)).padStart(2, '0')}:00`
}

/** First-of-month indices within a day list, for month ticks on day axes. */
export function monthStarts(days: readonly IsoDate[]): { index: number; label: string }[] {
  const out: { index: number; label: string }[] = []
  days.forEach((d, i) => {
    if (d.endsWith('-01')) out.push({ index: i, label: monthLabel(d, d.slice(5, 7) === '01' || out.length === 0) })
  })
  return out
}

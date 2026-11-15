import { useEffect, useMemo, useRef } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation, useSearchParams } from 'react-router'
import { BookOpen, Upload } from 'lucide-react'
import type { Dataset, MetricDef, Range } from '@/core/domain'
import { buildRegistry } from '@/core/metrics'
import { decodeSelection, encodeSelection, previousRange } from '@/core/range'
import { chunkMean, extent, isNum } from '@/core/stats'
import { compact } from '@/core/format'
import { formatRange } from '@/core/time'
import { useDaily, useMetrics, useStatus } from '@/infra/queries'
import { cn, EmptyState, Skeleton } from '@/ui/primitives'
import { CHAPTERS, type Chapter } from './chapters'
import { ObservatoryContext, useObservatory, type Observatory } from './context'
import { RangeControl } from './RangeControl'
import { spanOf, useResolvedRange, useUi } from './store'

/**
 * Root layout. Loads the dataset and metric registry, then either sends the reader to the import
 * page (no data yet) or provides the observatory context to every chapter.
 */
export function Shell() {
  const status = useStatus()
  const metrics = useMetrics()
  const { pathname } = useLocation()
  const open = pathname === '/import' || pathname === '/methods'

  if (status.isPending || metrics.isPending) return <BootScreen />
  if (status.isError || metrics.isError) {
    return (
      <Frame>
        <EmptyState title="The server did not answer">{(status.error ?? metrics.error)?.message}</EmptyState>
      </Frame>
    )
  }
  const dataset = status.data.dataset
  if (!dataset) {
    if (!open) return <Navigate to="/import" replace />
    return (
      <Frame>
        <Outlet />
      </Frame>
    )
  }
  return <ObservatoryLayout dataset={dataset} defs={metrics.data} />
}

function ObservatoryLayout({ dataset, defs }: { dataset: Dataset; defs: readonly MetricDef[] }) {
  useUrlSelection()
  const registry = useMemo(() => buildRegistry(defs), [defs])
  const range = useResolvedRange(dataset)
  const span = useMemo(() => spanOf(dataset), [dataset])
  const value = useMemo<Observatory>(
    () => ({ dataset, registry, span, range, prev: previousRange(range, span) }),
    [dataset, registry, span, range],
  )
  const { pathname, hash } = useLocation()
  const setHoverDay = useUi((s) => s.setHoverDay)
  useEffect(() => {
    setHoverDay(null)
    const target = hash && document.getElementById(hash.slice(1))
    if (target) target.scrollIntoView()
    else window.scrollTo(0, 0)
  }, [pathname, hash, setHoverDay])

  return (
    <ObservatoryContext value={value}>
      <div className="observatory-bg min-h-dvh lg:pl-[var(--rail-w)]">
        <Rail />
        <header className="sticky top-0 z-30 flex h-[var(--topbar-h)] items-center gap-4 border-b border-hairline bg-bg/85 px-4 backdrop-blur-md sm:px-8">
          <RangeControl />
          <ImportLink />
        </header>
        <MobileNav />
        <main className="mx-auto max-w-[1180px] px-4 pt-10 pb-24 sm:px-8">
          <Outlet />
        </main>
        <Footer />
      </div>
    </ObservatoryContext>
  )
}

/** The range selection lives in the store and mirrors to the URL; the URL wins on first load and on back/forward. */
function useUrlSelection() {
  const [params, setParams] = useSearchParams()
  const selection = useUi((s) => s.selection)
  const seeded = useRef(false)
  if (!seeded.current) {
    seeded.current = true
    useUi.setState({ selection: decodeSelection(params) })
  }
  useEffect(() => {
    const next = decodeSelection(params)
    if (JSON.stringify(next) !== JSON.stringify(useUi.getState().selection)) useUi.getState().setSelection(next)
  }, [params])
  useEffect(() => {
    const want = encodeSelection(selection)
    const have = Object.fromEntries(['range', 'from', 'to'].flatMap((k) => (params.has(k) ? [[k, params.get(k)!]] : [])))
    if (JSON.stringify(want) === JSON.stringify(have)) return
    setParams(
      (p) => {
        const out = new URLSearchParams(p)
        ;['range', 'from', 'to'].forEach((k) => out.delete(k))
        Object.entries(want).forEach(([k, v]) => out.set(k, v))
        return out
      },
      { replace: true },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection])
}

const SPARK_METRICS = CHAPTERS.flatMap((c) => (c.spark ? [c.spark] : []))

function useSparks(range: Range) {
  const daily = useDaily(range, SPARK_METRICS)
  return useMemo(() => {
    const out = new Map<string, (number | null)[]>()
    const d = daily.data
    if (!d) return out
    for (const k of SPARK_METRICS) out.set(k, chunkMean(d.columns[k] ?? [], 7))
    return out
  }, [daily.data])
}

function Rail() {
  const { dataset, range } = useObservatory()
  const sparks = useSparks(range)
  const { search } = useLocation()
  return (
    <nav aria-label="Chapters" className="fixed inset-y-0 left-0 z-40 hidden w-[var(--rail-w)] flex-col border-r border-hairline bg-surface/60 backdrop-blur-md lg:flex">
      <Link to={{ pathname: '/', search }} aria-label="Biomarx, back to the overview" className="logo flex h-[var(--topbar-h)] items-center gap-2.5 border-b border-hairline px-6">
        <LogoMark />
        <span className="display text-[21px] text-ink">Biomarx</span>
      </Link>
      <ol className="flex-1 space-y-0.5 overflow-y-auto px-3 py-5">
        {CHAPTERS.map((c) => (
          <li key={c.path}>
            <RailLink chapter={c} search={search} values={c.spark ? sparks.get(c.spark) : undefined} />
          </li>
        ))}
        <li className="mt-3 border-t border-hairline pt-3">
          <NavLink
            to={{ pathname: '/methods', search }}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 transition-colors',
                isActive ? 'bg-raised text-ink shadow-[inset_0_0_0_1px_var(--color-hairline)]' : 'text-ink-2 hover:bg-white/[0.025] hover:text-ink',
              )
            }
          >
            <BookOpen size={13} className="w-5 shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] leading-tight">Methods</span>
              <span className="block truncate text-[11px] text-ink-3">How every number is derived</span>
            </span>
          </NavLink>
        </li>
      </ol>
      <div className="border-t border-hairline px-6 py-5 text-[11.5px] text-ink-3">
        <div className="eyebrow mb-1">Dataset</div>
        <div className="num text-ink-2">{formatRange(dataset.start, dataset.end)}</div>
        <div className="num">
          {compact(dataset.records)} records · {dataset.nights} nights
        </div>
      </div>
    </nav>
  )
}

function ImportLink() {
  const { search } = useLocation()
  return (
    <NavLink
      to={{ pathname: '/import', search }}
      aria-label="Import a new export"
      className={({ isActive }) =>
        cn(
          'inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-hairline-2 px-2.5 text-[13px] font-medium text-ink transition-colors hover:bg-raised sm:px-3.5',
          isActive && 'bg-raised',
        )
      }
    >
      <Upload size={14} />
      <span className="hidden sm:inline">Import</span>
    </NavLink>
  )
}

function RailLink({ chapter: c, search, values }: { chapter: Chapter; search: string; values?: (number | null)[] }) {
  return (
    <NavLink
      to={{ pathname: c.path, search }}
      end={c.path === '/'}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-3 rounded-md px-3 py-2 transition-colors',
          isActive ? 'bg-raised text-ink shadow-[inset_0_0_0_1px_var(--color-hairline)]' : 'text-ink-2 hover:bg-white/[0.025] hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span className={cn('num w-5 text-[10.5px]', isActive ? 'text-ink-2' : 'text-ink-4')}>{c.n}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] leading-tight">{c.title}</span>
            <span className="block truncate text-[11px] text-ink-3">{c.kicker}</span>
          </span>
          {values ? <Spark values={values} color={c.color} active={isActive} /> : <PulseGlyph style={{ color: c.color, opacity: isActive ? 1 : 0.55 }} />}
        </>
      )}
    </NavLink>
  )
}

function Spark({ values, color, active }: { values: (number | null)[]; color: string; active: boolean }) {
  const W = 44
  const H = 16
  const d = useMemo(() => {
    const e = extent(values)
    if (!e || values.length < 2) return ''
    const [lo, hi] = e
    const span = hi - lo || 1
    let out = ''
    let pen = false
    values.forEach((v, i) => {
      if (!isNum(v)) {
        pen = false
        return
      }
      const x = (i / (values.length - 1)) * W
      const y = H - 1.5 - ((v - lo) / span) * (H - 3)
      out += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
      pen = true
    })
    return out
  }, [values])
  return (
    <svg width={W} height={H} aria-hidden className="shrink-0 overflow-visible">
      <path d={d} fill="none" stroke={color} strokeWidth={1.25} strokeLinejoin="round" opacity={active ? 1 : 0.55} />
    </svg>
  )
}

export function PulseGlyph({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg width={44} height={16} viewBox="0 0 44 16" aria-hidden className={cn('shrink-0', className)} style={style}>
      <path d="M0 9h14l3-6 4 11 3-8 2 3h18" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

const PULSE = 'M0 9h14l3-6 4 11 3-8 2 3h18'

/**
 * The wordmark's pulse. At rest a bright segment sweeps the trace about once every three seconds,
 * like a monitor at a slow resting rate; hovering the logo raises the rate and brightens the trace.
 * The styling and timing live in tokens.css under `.logo`.
 */
function LogoMark() {
  return (
    <svg width={44} height={16} viewBox="0 0 44 16" aria-hidden className="logo-mark shrink-0 overflow-visible text-ember">
      <path className="logo-base" d={PULSE} pathLength={100} />
      <path className="logo-sweep" d={PULSE} pathLength={100} />
    </svg>
  )
}

function MobileNav() {
  const { search } = useLocation()
  return (
    <nav aria-label="Chapters" className="flex gap-1 overflow-x-auto border-b border-hairline px-4 py-2 lg:hidden">
      {CHAPTERS.map((c) => (
        <NavLink
          key={c.path}
          to={{ pathname: c.path, search }}
          end={c.path === '/'}
          className={({ isActive }) => cn('shrink-0 rounded-md px-3 py-1.5 text-[13px] whitespace-nowrap', isActive ? 'bg-raised text-ink' : 'text-ink-3')}
        >
          {c.title}
        </NavLink>
      ))}
      <NavLink
        to={{ pathname: '/methods', search }}
        className={({ isActive }) => cn('shrink-0 rounded-md px-3 py-1.5 text-[13px] whitespace-nowrap', isActive ? 'bg-raised text-ink' : 'text-ink-3')}
      >
        Methods
      </NavLink>
    </nav>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="observatory-bg min-h-dvh">
      <header className="flex h-[var(--topbar-h)] items-center justify-between gap-4 border-b border-hairline px-6">
        <Link to="/import" className="logo flex items-center gap-2.5">
          <LogoMark />
          <span className="display text-[21px] text-ink">Biomarx</span>
        </Link>
        <NavLink to="/methods" className={({ isActive }) => cn('inline-flex items-center gap-2 text-[13px] transition-colors hover:text-ink', isActive ? 'text-ink' : 'text-ink-3')}>
          <BookOpen size={14} />
          Methods
        </NavLink>
      </header>
      <main className="mx-auto max-w-[1180px] px-4 pt-10 pb-24 sm:px-8">{children}</main>
      <Footer />
    </div>
  )
}

function BootScreen() {
  return (
    <div className="observatory-bg min-h-dvh lg:pl-[var(--rail-w)]">
      <div className="mx-auto max-w-[1180px] space-y-6 px-8 pt-24">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-72 w-full" />
      </div>
    </div>
  )
}

const REPO = 'https://github.com/vasu2912/biomarx'

function Footer() {
  return (
    <footer className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-hairline px-4 py-6 text-[12px] text-ink-3 sm:px-8">
      <span className="inline-flex items-center gap-1.5">
        Made by
        <a href="https://github.com/vasu2912" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-ink-2 transition-colors hover:text-ink">
          <GitHubMark />
          Vasu
        </a>
      </span>
      <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer" className="transition-colors hover:text-ink">
        Open source under the MIT License
      </a>
    </footer>
  )
}

/** lucide dropped brand icons in 1.0, so the GitHub mark is drawn here. */
function GitHubMark() {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

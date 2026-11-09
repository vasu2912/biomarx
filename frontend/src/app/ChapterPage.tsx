import type { ReactNode } from 'react'
import { useLocation } from 'react-router'
import { formatRange } from '@/core/time'
import { CHAPTERS } from './chapters'
import { useObservatory } from './context'

/** Header and vertical rhythm shared by every chapter; the chapter is looked up from the route. */
export function ChapterPage({ lede, children }: { lede?: ReactNode; children: ReactNode }) {
  const { pathname } = useLocation()
  const { range } = useObservatory()
  const c = CHAPTERS.find((x) => x.path === pathname) ?? CHAPTERS[0]
  return (
    <article>
      <header className="mb-14 max-w-[78ch]">
        <div className="eyebrow mb-3 flex items-center gap-3">
          <span style={{ color: c.color }}>Chapter {c.n}</span>
          <span className="h-px w-8 bg-hairline-2" />
          <span className="num normal-case tracking-normal">{formatRange(range.start, range.end)}</span>
        </div>
        <h1 className="display text-[44px] leading-[1.05] text-ink sm:text-[54px]">{c.title}</h1>
        <p className="display mt-2 text-[20px] text-ink-2 italic">{c.kicker}</p>
        {lede && <div className="mt-5 text-[15px] leading-relaxed text-ink-2">{lede}</div>}
      </header>
      <div className="space-y-20">{children}</div>
    </article>
  )
}

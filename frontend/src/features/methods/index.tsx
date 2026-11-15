import { Link, useLocation } from 'react-router'
import { Info } from 'lucide-react'
import { SIGNAL } from '@/core/color'
import { CHAPTERS } from '@/app/chapters'
import { methodsAnchor } from '@/ui/charts/Figure'
import { SECTIONS, type Method, type MethodSection } from './content'

const sectionId = (chapter: number | null) => (chapter == null ? 'foundations' : methodsAnchor(chapter))

const heading = (s: MethodSection) => {
  if (s.chapter == null) return { n: '00', title: 'Foundations', color: SIGNAL.core, path: null }
  const c = CHAPTERS[s.chapter - 1]
  return { n: c.n, title: c.title, color: c.color, path: c.path }
}

/** The reference page: how every figure's numbers are derived, chapter by chapter, with the published sources. */
export default function Methods() {
  const { search } = useLocation()
  return (
    <article>
      <header className="mb-14 max-w-[78ch]">
        <div className="eyebrow mb-3 flex items-center gap-3">
          <span style={{ color: SIGNAL.sun }}>Reference</span>
          <span className="h-px w-8 bg-hairline-2" />
          <span className="normal-case tracking-normal">{SECTIONS.reduce((n, s) => n + s.methods.length, 0)} methods</span>
        </div>
        <h1 className="display text-[44px] leading-[1.05] text-ink sm:text-[54px]">Methods</h1>
        <p className="display mt-2 text-[20px] text-ink-2 italic">How every number is derived</p>
        <p className="mt-5 text-[15px] leading-relaxed text-ink-2">
          Each figure’s <Info size={13} aria-label="info" className="inline align-[-2px] text-ink" /> button gives a short note on its method. This page collects them in full, with formulas, thresholds and the published sources
          they follow. It covers the science, not the software; the source code is open for that.
        </p>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-[180px_minmax(0,1fr)]">
        <nav aria-label="Methods sections" className="hidden lg:block">
          <ol className="sticky top-[calc(var(--topbar-h)+40px)] space-y-1 text-[13px]">
            {SECTIONS.map((s) => {
              const h = heading(s)
              return (
                <li key={h.n}>
                  <a href={`#${sectionId(s.chapter)}`} className="flex items-baseline gap-2.5 rounded-md px-2 py-1 text-ink-2 transition-colors hover:bg-raised hover:text-ink">
                    <span className="num w-5 text-[10.5px] text-ink-4">{h.n}</span>
                    {h.title}
                  </a>
                </li>
              )
            })}
          </ol>
        </nav>

        <div className="max-w-[78ch] space-y-20">
          {SECTIONS.map((s) => {
            const h = heading(s)
            return (
              <section key={h.n} id={sectionId(s.chapter)} className="scroll-mt-[calc(var(--topbar-h)+32px)]">
                <div className="eyebrow mb-3 flex items-center gap-3">
                  <span style={{ color: h.color }}>{s.chapter == null ? 'Every chapter' : `Chapter ${h.n}`}</span>
                  <span className="h-px flex-1 bg-hairline" />
                  {h.path && (
                    <Link to={{ pathname: h.path, search }} className="normal-case tracking-normal text-ink-3 transition-colors hover:text-ink">
                      Open chapter →
                    </Link>
                  )}
                </div>
                <h2 className="display text-[32px] leading-[1.1] text-ink">{h.title}</h2>
                <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">{s.intro}</p>
                <div className="mt-8 space-y-9">
                  {s.methods.map((m) => (
                    <MethodEntry key={m.title} method={m} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </article>
  )
}

function MethodEntry({ method: m }: { method: Method }) {
  return (
    <div className="border-t border-hairline pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="display text-[21px] leading-[1.2] text-ink">{m.title}</h3>
        {m.figs && <span className="eyebrow !text-ink-3">{m.figs.map((f) => `Fig. ${f}`).join(' · ')}</span>}
      </div>
      <div className="mt-2.5 space-y-2.5 text-[14px] leading-relaxed text-ink-2">{m.body}</div>
      {m.formula && (
        <pre className="num mt-4 overflow-x-auto rounded-md border border-hairline bg-sunken/70 px-4 py-3 text-[12.5px] leading-relaxed whitespace-pre text-ink">{m.formula.join('\n')}</pre>
      )}
      {m.cite && (
        <ul className="mt-4 space-y-1 text-[12px] leading-snug text-ink-3 italic">
          {m.cite.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

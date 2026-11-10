import { motion, useReducedMotion } from 'motion/react'
import { Link, useLocation } from 'react-router'
import { SIGNAL } from '@/core/color'
import { CHAPTERS } from './chapters'
import { PulseGlyph } from './Shell'

/** Strip geometry, in SVG units: 25 mm/s paper with 1 mm minor and 5 mm major squares. */
const W = 960
const H = 200
const MINOR = 8
const MAJOR = MINOR * 5
const BASE = 112
const BEAT = 128
const BEATS = 4

/** One PQRST complex starting at x0; `gain` shrinks the later beats as the lead lifts off. */
function beat(x0: number, gain = 1) {
  const y = (dy: number) => (BASE - dy * gain).toFixed(1)
  return [
    `L${x0 + 14},${BASE}`,
    `Q${x0 + 22},${y(14)} ${x0 + 30},${BASE}`, // P
    `L${x0 + 40},${BASE}`,
    `L${x0 + 44},${y(-7)}`, // Q
    `L${x0 + 49},${y(74)}`, // R
    `L${x0 + 55},${y(-20)}`, // S
    `L${x0 + 60},${BASE}`,
    `L${x0 + 72},${BASE}`,
    `Q${x0 + 86},${y(24)} ${x0 + 100},${BASE}`, // T
    `L${x0 + BEAT},${BASE}`,
  ].join(' ')
}

const GAINS = [1, 1, 0.82, 0.45]
const LOST_AT = BEAT * BEATS
const TRACE = `M0,${BASE} ${GAINS.map((g, i) => beat(i * BEAT, g)).join(' ')} L${W},${BASE}`

/**
 * The 404 page: a single-lead strip that beats a few times, then the lead comes off and the trace
 * runs flat. Below it, every chapter that does have a signal.
 */
export default function NotFound() {
  const { pathname, search } = useLocation()
  const reduced = useReducedMotion()

  return (
    <article>
      <header className="mb-10 max-w-[78ch]">
        <div className="eyebrow mb-3 flex items-center gap-3">
          <span style={{ color: SIGNAL.awake }}>Chapter 404</span>
          <span className="h-px w-8 bg-hairline-2" />
          <span className="num truncate normal-case tracking-normal">{pathname}</span>
        </div>
        <h1 className="display text-[44px] leading-[1.05] text-ink sm:text-[54px]">No such chapter</h1>
        <p className="display mt-2 text-[20px] text-ink-2 italic">The lead came off before this page was recorded.</p>
      </header>

      <figure className="overflow-hidden rounded-lg border border-hairline bg-sunken/70">
        <div className="flex items-center justify-between gap-4 border-b border-hairline px-4 py-2.5 sm:px-5">
          <span className="eyebrow">Lead I · 25 mm/s · 10 mm/mV</span>
          <span className="num flex items-center gap-2 text-[12px] text-ink-3">
            <motion.span
              className="inline-block size-1.5 rounded-full"
              style={{ background: SIGNAL.awake }}
              animate={reduced ? undefined : { opacity: [1, 0.2, 1] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            />
            HR <span className="text-ink-2">--</span> bpm
          </span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="An ECG trace that beats four times and then goes flat">
          <defs>
            <pattern id="nf-minor" width={MINOR} height={MINOR} patternUnits="userSpaceOnUse">
              <path d={`M${MINOR},0V${MINOR}H0`} fill="none" stroke={SIGNAL.awake} strokeOpacity={0.07} strokeWidth={0.6} />
            </pattern>
            <pattern id="nf-major" width={MAJOR} height={MAJOR} patternUnits="userSpaceOnUse">
              <rect width={MAJOR} height={MAJOR} fill="url(#nf-minor)" />
              <path d={`M${MAJOR},0V${MAJOR}H0`} fill="none" stroke={SIGNAL.awake} strokeOpacity={0.16} strokeWidth={0.8} />
            </pattern>
            <linearGradient id="nf-fade" x1="0" x2="1">
              <stop offset="0" stopColor={SIGNAL.awake} />
              <stop offset={(LOST_AT / W).toFixed(3)} stopColor={SIGNAL.awake} />
              <stop offset="1" stopColor={SIGNAL.ink4} />
            </linearGradient>
            <filter id="nf-glow" x="-5%" y="-30%" width="110%" height="160%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
          </defs>

          <rect width={W} height={H} fill="url(#nf-major)" />

          <motion.path
            d={TRACE}
            fill="none"
            stroke="url(#nf-fade)"
            strokeWidth={5}
            strokeLinejoin="round"
            filter="url(#nf-glow)"
            opacity={0.35}
            initial={reduced ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 2.6, ease: 'linear' }}
          />
          <motion.path
            d={TRACE}
            fill="none"
            stroke="url(#nf-fade)"
            strokeWidth={1.75}
            strokeLinejoin="round"
            strokeLinecap="round"
            initial={reduced ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 2.6, ease: 'linear' }}
          />

          <motion.g initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reduced ? 0 : 1.9, duration: 0.6 }}>
            <line x1={LOST_AT} x2={LOST_AT} y1={24} y2={H - 24} stroke={SIGNAL.ink4} strokeDasharray="2 4" />
            <text x={LOST_AT + 12} y={BASE - 14} fontSize={11} fill={SIGNAL.ink3} letterSpacing="0.14em">
              LEAD OFF
            </text>
            <text x={W - 16} y={BASE + 52} fontSize={64} fill={SIGNAL.ink} fillOpacity={0.08} textAnchor="end" fontWeight={500}>
              404
            </text>
          </motion.g>
        </svg>
        <figcaption className="border-t border-hairline px-4 py-3 text-[13px] text-ink-3 sm:px-5">
          Nothing in the export answers to <span className="num text-ink-2">{pathname}</span>. The chapters below all have a signal.
        </figcaption>
      </figure>

      <section className="mt-14">
        <div className="mb-4 flex items-center gap-3">
          <span className="eyebrow">Chapters</span>
          <span className="h-px flex-1 bg-hairline" />
        </div>
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CHAPTERS.map((c) => (
            <li key={c.path}>
              <Link
                to={{ pathname: c.path, search }}
                className="group flex items-center gap-3 rounded-md border border-hairline bg-surface/50 px-4 py-3 transition-colors hover:border-hairline-2 hover:bg-raised"
              >
                <span className="num w-5 text-[10.5px] text-ink-4">{c.n}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] leading-tight text-ink-2 transition-colors group-hover:text-ink">{c.title}</span>
                  <span className="block truncate text-[11.5px] text-ink-3">{c.kicker}</span>
                </span>
                <PulseGlyph className="opacity-55 transition-opacity group-hover:opacity-100" style={{ color: c.color }} />
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </article>
  )
}

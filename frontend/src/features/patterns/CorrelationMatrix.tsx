import { useState } from 'react'
import { inkOn, ramps, SIGNAL } from '@/core/color'
import { def, type Registry } from '@/core/metrics'
import { AX, useWidth } from '@/ui/charts/axes'
import { HoverCard } from '@/ui/charts/HoverCard'
import { cellOf, formatQ, formatRho, type Cell, type CorrModel, type Pair } from './model'

const LEFT = 140
const TOP = 4
const LABEL_BAND = 104

export const rhoColor = (r: number) => ramps.diverging((Math.max(-1, Math.min(1, r)) + 1) / 2)

export function shortLabel(registry: Registry, key: string, max = 20): string {
  const l = def(registry, key).label
  return l.length > max ? `${l.slice(0, max - 1)}…` : l
}

export function CorrelationMatrix({ model, registry, pair, onSelect }: { model: CorrModel; registry: Registry; pair: Pair | null; onSelect: (p: Pair) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<Cell | null>(null)
  const k = model.metrics.length - 1
  const cell = Math.max(12, Math.min(30, Math.floor((width - LEFT - 4) / k)))
  const side = cell * k
  const height = TOP + side + LABEL_BAND
  const selected = pair ? cellOf(model, pair) : null
  const strong = (key: string) => [hover?.a, hover?.b, selected?.a, selected?.b].includes(key)

  return (
    <div ref={ref} className="relative" style={{ height }} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Spearman correlation matrix of daily metrics">
          <g transform={`translate(${LEFT},${TOP})`}>
            {model.cells.map((c) => {
              const fill = c.rho == null ? SIGNAL.unworn : rhoColor(c.rho)
              return (
                <g key={`${c.row}:${c.col}`} transform={`translate(${c.col * cell},${c.row * cell})`}>
                  <rect
                    x={1}
                    y={1}
                    width={cell - 2}
                    height={cell - 2}
                    rx={2}
                    fill={fill}
                    className="cursor-pointer"
                    onPointerEnter={() => setHover(c)}
                    onClick={() => onSelect({ a: c.a, b: c.b })}
                  />
                  {c.sig && <circle cx={cell / 2} cy={cell / 2} r={Math.max(1.6, cell * 0.09)} fill={inkOn(fill)} opacity={0.85} pointerEvents="none" />}
                </g>
              )
            })}
            {[hover, selected].map(
              (c, i) =>
                c && (
                  <rect
                    key={i}
                    x={c.col * cell + 0.5}
                    y={c.row * cell + 0.5}
                    width={cell - 1}
                    height={cell - 1}
                    rx={2.5}
                    fill="none"
                    stroke={i === 0 ? SIGNAL.ink2 : SIGNAL.ink}
                    strokeWidth={1.5}
                    pointerEvents="none"
                  />
                ),
            )}
            {model.metrics.slice(1).map((key, r) => (
              <text key={key} x={-8} y={r * cell + cell / 2} dy="0.32em" textAnchor="end" fontSize={AX.font + 0.5} fill={strong(key) ? SIGNAL.ink : AX.label}>
                {shortLabel(registry, key)}
              </text>
            ))}
            {model.metrics.slice(0, -1).map((key, c) => (
              <text
                key={key}
                transform={`translate(${c * cell + cell / 2},${side + 8}) rotate(-50)`}
                dy="0.32em"
                textAnchor="end"
                fontSize={AX.font + 0.5}
                fill={strong(key) ? SIGNAL.ink : AX.label}
              >
                {shortLabel(registry, key, 18)}
              </text>
            ))}
          </g>
        </svg>
      )}
      {hover && (
        <HoverCard
          x={LEFT + (hover.col + 1) * cell}
          y={TOP + hover.row * cell}
          containerW={width}
          title={`${def(registry, hover.a).label} × ${def(registry, hover.b).label}`}
          rows={[
            { label: 'Spearman ρ', value: formatRho(hover.rho), color: hover.rho == null ? undefined : rhoColor(hover.rho), kind: 'swatch' },
            { label: hover.sig ? 'FDR significant' : 'not significant', value: formatQ(hover.q) },
            { label: 'days with both', value: hover.n == null ? '—' : String(hover.n) },
          ]}
          footer="Click to plot this pair"
        />
      )}
    </div>
  )
}

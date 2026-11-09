import { interpolateRgbBasis } from 'd3-interpolate'
import { color as d3color } from 'd3-color'

/** The semantic signal palette. Mirrors tokens.css; canvas and SVG fills read from here. */
export const SIGNAL = {
  bg: '#07090c',
  surface: '#0d1015',
  raised: '#131820',
  ink: '#eceae4',
  ink2: '#a7a69e',
  ink3: '#7c7d76',
  ink4: '#4a4b47',
  hairline: 'rgba(236,234,228,0.08)',
  grid: 'rgba(236,234,228,0.06)',
  deep: '#4c5bff',
  core: '#86a8f0',
  rem: '#41cfc3',
  awake: '#f2677b',
  worn: '#29231b',
  unworn: '#0f1318',
  sun: '#f4b94a',
  ember: '#ff6b3d',
  hrv: '#a88bff',
  spo2: '#4cc3f0',
  resp: '#d9c07a',
  onset: '#e2557f',
  mid: '#41cfc3',
  wake: '#f4b94a',
  cool: '#5b8dee',
} as const

export type Signal = keyof typeof SIGNAL

/** Codes in the `sleep` raster. */
export const STAGE_CODE = { unworn: 0, worn: 1, awake: 2, core: 3, rem: 4, deep: 5 } as const
export const STAGES = [
  { key: 'deep', label: 'Deep', color: SIGNAL.deep },
  { key: 'core', label: 'Core', color: SIGNAL.core },
  { key: 'rem', label: 'REM', color: SIGNAL.rem },
  { key: 'awake', label: 'Awake in bed', color: SIGNAL.awake },
] as const
export type StageKey = (typeof STAGES)[number]['key']

export type Ramp = (t: number) => string

export const ramps = {
  ember: interpolateRgbBasis(['#0b0d11', '#2a130c', '#6b2a12', '#c4461f', '#ff6b3d', '#ffa477', '#ffd9bd', '#fff4e8']),
  sun: interpolateRgbBasis(['#0b0d11', '#1d1709', '#4a3410', '#9a6a1a', '#f4b94a', '#fde2a6', '#fff8e6']),
  indigo: interpolateRgbBasis(['#0b0d11', '#151a3a', '#26307a', '#4c5bff', '#86a8f0', '#d7e2fb']),
  /** cool blue <- neutral slate -> ember; midpoint is a gray, never a hue. */
  diverging: interpolateRgbBasis(['#b9d2fa', '#5b8dee', '#263c66', '#252a31', '#6b2e17', '#ff6b3d', '#ffc6a6']),
} satisfies Record<string, Ramp>

export interface Lut {
  /** RGBA bytes, 4 per entry. */
  bytes: Uint8ClampedArray
  size: number
}

export function buildLut(ramp: Ramp, size = 256): Lut {
  const bytes = new Uint8ClampedArray(size * 4)
  for (let i = 0; i < size; i++) {
    const c = d3color(ramp(i / (size - 1)))!.rgb()
    bytes.set([c.r, c.g, c.b, 255], i * 4)
  }
  return { bytes, size }
}

export function categoricalLut(colors: readonly string[]): Lut {
  const bytes = new Uint8ClampedArray(colors.length * 4)
  colors.forEach((hex, i) => {
    const c = d3color(hex)!.rgb()
    bytes.set([c.r, c.g, c.b, 255], i * 4)
  })
  return { bytes, size: colors.length }
}

export function withAlpha(hex: string, a: number): string {
  const c = d3color(hex)!.rgb()
  return `rgba(${c.r},${c.g},${c.b},${a})`
}

/** Ink color that stays legible on top of a given fill. */
export function inkOn(fill: string): string {
  const c = d3color(fill)!.rgb()
  const l = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255
  return l > 0.55 ? SIGNAL.bg : SIGNAL.ink
}

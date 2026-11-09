import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useWidth, type Margin } from './axes'

export interface RasterGeom {
  width: number
  height: number
  innerW: number
  innerH: number
  margin: Margin
  /** column (may be fractional) to px, relative to the inner plot */
  x: (col: number) => number
  /** row to px of the row's top edge */
  y: (row: number) => number
  rowH: number
}

/**
 * One pixel per cell, painted once per data change into an offscreen canvas at native size, then
 * resampled to the display: columns are averaged (smoothing on) when shrinking so minute detail
 * blends instead of aliasing, rows are scaled nearest-neighbour so each day stays a crisp band.
 */
export function RasterCanvas({
  rows,
  cols,
  paint,
  height,
  margin,
  overlay,
  under,
  onHover,
  label,
}: {
  rows: number
  cols: number
  /** fills the native-resolution image; identity of this function is the redraw key */
  paint: (img: ImageData) => void
  height: number | ((innerW: number) => number)
  margin: Margin
  overlay?: (g: RasterGeom) => ReactNode
  under?: (g: RasterGeom) => ReactNode
  onHover?: (cell: { row: number; col: number } | null) => void
  label: string
}) {
  const [wrapRef, width] = useWidth<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const innerW = Math.max(0, width - margin.left - margin.right)
  const h = typeof height === 'function' ? height(innerW) : height
  const innerH = Math.max(0, h - margin.top - margin.bottom)

  const native = useMemo(() => {
    if (!rows || !cols) return null
    const c = document.createElement('canvas')
    c.width = cols
    c.height = rows
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(cols, rows)
    paint(img)
    ctx.putImageData(img, 0, 0)
    return c
  }, [rows, cols, paint])

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !native || innerW <= 0 || innerH <= 0) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const W = Math.round(innerW * dpr)
    const H = Math.round(innerH * dpr)
    cv.width = W
    cv.height = H
    const mid = document.createElement('canvas')
    mid.width = W
    mid.height = rows
    const mctx = mid.getContext('2d')!
    mctx.imageSmoothingEnabled = W < cols
    mctx.imageSmoothingQuality = 'high'
    mctx.drawImage(native, 0, 0, W, rows)
    const ctx = cv.getContext('2d')!
    ctx.imageSmoothingEnabled = H < rows
    ctx.clearRect(0, 0, W, H)
    ctx.drawImage(mid, 0, 0, W, H)
  }, [native, innerW, innerH, rows, cols])

  const g: RasterGeom = {
    width,
    height: h,
    innerW,
    innerH,
    margin,
    x: (c) => (c / cols) * innerW,
    y: (r) => (r / rows) * innerH,
    rowH: rows ? innerH / rows : 0,
  }

  const onMove = (e: React.PointerEvent) => {
    if (!onHover) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    if (px < 0 || py < 0 || px > innerW || py > innerH) return onHover(null)
    onHover({ row: Math.min(rows - 1, Math.floor((py / innerH) * rows)), col: Math.min(cols - 1, Math.floor((px / innerW) * cols)) })
  }

  return (
    <div ref={wrapRef} style={{ height: h, position: 'relative' }}>
      {width > 0 && (
        <>
          <svg width={width} height={h} className="absolute inset-0 overflow-visible" aria-hidden>
            <g transform={`translate(${margin.left},${margin.top})`}>{under?.(g)}</g>
          </svg>
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={label}
            data-raster
            className="absolute"
            style={{ left: margin.left, top: margin.top, width: innerW, height: innerH }}
          />
          <svg width={width} height={h} className="pointer-events-none absolute inset-0 overflow-visible">
            <g transform={`translate(${margin.left},${margin.top})`}>{overlay?.(g)}</g>
          </svg>
          <div
            className="absolute"
            style={{ left: margin.left, top: margin.top, width: innerW, height: innerH }}
            onPointerMove={onMove}
            onPointerLeave={() => onHover?.(null)}
          />
        </>
      )}
    </div>
  )
}

/** Paint helper: map each cell through a value -> LUT-index function. NaN/negative index = `empty` color. */
export function paintLut(
  data: ArrayLike<number>,
  lut: Uint8ClampedArray,
  index: (v: number, i: number) => number,
  empty: [number, number, number, number],
) {
  return (img: ImageData) => {
    const px = img.data
    for (let i = 0; i < data.length; i++) {
      const k = index(data[i], i)
      const o = i * 4
      if (k < 0 || !Number.isFinite(k)) {
        px[o] = empty[0]
        px[o + 1] = empty[1]
        px[o + 2] = empty[2]
        px[o + 3] = empty[3]
      } else {
        const l = k * 4
        px[o] = lut[l]
        px[o + 1] = lut[l + 1]
        px[o + 2] = lut[l + 2]
        px[o + 3] = lut[l + 3]
      }
    }
  }
}

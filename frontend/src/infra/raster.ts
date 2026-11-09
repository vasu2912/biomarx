import type { Range, Raster } from '@/core/domain'
import { ApiError, rangeQuery, raw } from './http'

export type RasterName = 'sleep' | 'hr5' | 'steps10'

/** Decode the binary raster endpoint: a little-endian row-major matrix described by X-Shape / X-Dtype / X-Start. */
export async function fetchRaster(name: RasterName, range: Range, signal?: AbortSignal): Promise<Raster> {
  const res = await raw(`/rasters/${name}`, { query: rangeQuery(range), signal })
  const shape = res.headers.get('X-Shape')
  const dtype = res.headers.get('X-Dtype')
  const start = res.headers.get('X-Start')
  if (!shape || !dtype || !start) throw new ApiError(500, `raster ${name}: missing shape headers`)
  const [rows, cols] = shape.split(',').map(Number)
  const buf = await res.arrayBuffer()
  const data = dtype === 'uint8' ? new Uint8Array(buf) : dtype === 'float32' ? new Float32Array(buf) : null
  if (!data) throw new ApiError(500, `raster ${name}: unsupported dtype ${dtype}`)
  if (data.length !== rows * cols) throw new ApiError(500, `raster ${name}: ${data.length} values for shape ${shape}`)
  return { rows, cols, start, data }
}

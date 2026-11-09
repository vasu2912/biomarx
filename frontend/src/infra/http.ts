import createClient from 'openapi-fetch'
import type { paths } from '@/core/api.gen'
import type { Range } from '@/core/domain'

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const api = createClient<paths>({ baseUrl: '' })

export const rangeQuery = (r: Range) => ({ start: r.start, end: r.end })

function detail(error: unknown): string {
  if (error && typeof error === 'object' && 'detail' in error) {
    const d = (error as { detail: unknown }).detail
    return typeof d === 'string' ? d : JSON.stringify(d)
  }
  return 'Request failed'
}

/** Unwrap an openapi-fetch result: data on success, ApiError otherwise. */
export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await p
  if (data === undefined) throw new ApiError(response.status, detail(error))
  return data
}

/** Binary endpoints and chunk uploads go through plain fetch; the schema can't describe their bodies. */
export async function raw(path: string, init: RequestInit & { query?: Record<string, string> } = {}): Promise<Response> {
  const qs = init.query ? `?${new URLSearchParams(init.query)}` : ''
  const res = await fetch(`/api${path}${qs}`, init)
  if (!res.ok) {
    let msg = res.statusText
    try {
      msg = detail(await res.json())
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, msg)
  }
  return res
}

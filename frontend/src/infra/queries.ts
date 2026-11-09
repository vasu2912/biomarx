import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query'
import type { Range } from '@/core/domain'
import { api, rangeQuery, unwrap } from './http'
import { fetchRaster, type RasterName } from './raster'

const rk = (r: Range | null | undefined) => (r ? `${r.start}..${r.end}` : 'none')

export const qk = {
  status: ['status'] as const,
  metrics: ['metrics'] as const,
  import: (id: string) => ['import', id] as const,
  data: ['data'] as const,
  summary: (r: Range | null) => ['data', 'summary', rk(r)] as const,
  daily: (r: Range, metrics?: readonly string[]) => ['data', 'daily', rk(r), metrics?.join(',') ?? '*'] as const,
  nights: (r: Range) => ['data', 'nights', rk(r)] as const,
  raster: (name: RasterName, r: Range) => ['data', 'raster', name, rk(r)] as const,
  analysis: (name: string, r: Range) => ['data', 'analysis', name, rk(r)] as const,
  ecgList: ['data', 'ecg'] as const,
  ecg: (id: string) => ['data', 'ecg', id] as const,
}

/** Range-keyed data never goes stale (a re-import invalidates `data`); a new range keeps the old frame while loading. */
const ranged = { placeholderData: keepPreviousData, staleTime: Infinity } as const

export const statusQuery = queryOptions({
  queryKey: qk.status,
  queryFn: ({ signal }) => unwrap(api.GET('/api/status', { signal })),
  staleTime: 5_000,
})

export const useStatus = () => useQuery(statusQuery)

export const useMetrics = () =>
  useQuery({ queryKey: qk.metrics, queryFn: ({ signal }) => unwrap(api.GET('/api/metrics', { signal })), staleTime: Infinity })

export const useSummary = (r: Range | null) =>
  useQuery({
    queryKey: qk.summary(r),
    queryFn: ({ signal }) => unwrap(api.GET('/api/summary', { params: { query: rangeQuery(r!) }, signal })),
    enabled: r != null,
    ...ranged,
  })

export const useDaily = (r: Range | null, metrics?: readonly string[]) =>
  useQuery({
    queryKey: qk.daily(r ?? { start: '', end: '' }, metrics),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/daily', { params: { query: { ...rangeQuery(r!), metrics: metrics?.join(',') } }, signal })),
    enabled: r != null,
    ...ranged,
  })

export const useNights = (r: Range) =>
  useQuery({
    queryKey: qk.nights(r),
    queryFn: ({ signal }) => unwrap(api.GET('/api/nights', { params: { query: rangeQuery(r) }, signal })),
    ...ranged,
  })

export const useRaster = (name: RasterName, r: Range) =>
  useQuery({ queryKey: qk.raster(name, r), queryFn: ({ signal }) => fetchRaster(name, r, signal), ...ranged })

const q = (r: Range) => ({ params: { query: rangeQuery(r) } })

export const useArchitecture = (r: Range) =>
  useQuery({ queryKey: qk.analysis('architecture', r), queryFn: ({ signal }) => unwrap(api.GET('/api/analysis/architecture', { ...q(r), signal })), ...ranged })
export const useChronotype = (r: Range) =>
  useQuery({ queryKey: qk.analysis('chronotype', r), queryFn: ({ signal }) => unwrap(api.GET('/api/analysis/chronotype', { ...q(r), signal })), ...ranged })
export const usePeriodogram = (r: Range) =>
  useQuery({ queryKey: qk.analysis('periodogram', r), queryFn: ({ signal }) => unwrap(api.GET('/api/analysis/periodogram', { ...q(r), signal })), ...ranged })
export const useCorrelation = (r: Range) =>
  useQuery({ queryKey: qk.analysis('correlation', r), queryFn: ({ signal }) => unwrap(api.GET('/api/analysis/correlation', { ...q(r), signal })), ...ranged })
export const useStateMatrix = (r: Range) =>
  useQuery({ queryKey: qk.analysis('state', r), queryFn: ({ signal }) => unwrap(api.GET('/api/analysis/state', { ...q(r), signal })), ...ranged })
export const useHrActivity = (r: Range) =>
  useQuery({ queryKey: qk.analysis('hr-activity', r), queryFn: ({ signal }) => unwrap(api.GET('/api/analysis/hr-activity', { ...q(r), signal })), ...ranged })

export const useEcgList = () =>
  useQuery({ queryKey: qk.ecgList, queryFn: ({ signal }) => unwrap(api.GET('/api/ecg', { signal })), staleTime: Infinity })

export const useEcg = (id: string | null) =>
  useQuery({
    queryKey: qk.ecg(id ?? ''),
    queryFn: ({ signal }) => unwrap(api.GET('/api/ecg/{ecg_id}', { params: { path: { ecg_id: id! } }, signal })),
    enabled: id != null,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  })

export const useImportJob = (id: string | null) =>
  useQuery({
    queryKey: qk.import(id ?? ''),
    queryFn: ({ signal }) => unwrap(api.GET('/api/imports/{job_id}', { params: { path: { job_id: id! } }, signal })),
    enabled: id != null,
    refetchInterval: (query) => {
      const s = query.state.data?.state
      return s === 'ready' || s === 'failed' ? false : 1000
    },
  })

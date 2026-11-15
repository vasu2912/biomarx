import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Journal, JournalDay, ProfileInput, Range } from '@/core/domain'
import { api, rangeQuery, unwrap } from './http'
import { fetchRaster, type RasterName } from './raster'

const rk = (r: Range | null | undefined) => (r ? `${r.start}..${r.end}` : 'none')

export const qk = {
  status: ['status'] as const,
  metrics: ['metrics'] as const,
  profile: ['profile'] as const,
  import: (id: string) => ['import', id] as const,
  data: ['data'] as const,
  summary: (r: Range | null) => ['data', 'summary', rk(r)] as const,
  daily: (r: Range, metrics?: readonly string[]) => ['data', 'daily', rk(r), metrics?.join(',') ?? '*'] as const,
  nights: (r: Range) => ['data', 'nights', rk(r)] as const,
  raster: (name: RasterName, r: Range) => ['data', 'raster', name, rk(r)] as const,
  analysis: (name: string, r: Range) => ['data', 'analysis', name, rk(r)] as const,
  ecgList: ['data', 'ecg'] as const,
  ecg: (id: string) => ['data', 'ecg', id] as const,
  journal: (r: Range) => ['journal', rk(r)] as const,
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

export const useFitness = (r: Range) =>
  useQuery({ queryKey: qk.analysis('fitness', r), queryFn: ({ signal }) => unwrap(api.GET('/api/analysis/fitness', { ...q(r), signal })), ...ranged })

export const useBaseline = (r: Range) =>
  useQuery({ queryKey: qk.analysis('baseline', r), queryFn: ({ signal }) => unwrap(api.GET('/api/analysis/baseline', { ...q(r), signal })), ...ranged })
export const useSevenHours = (r: Range) =>
  useQuery({ queryKey: qk.analysis('seven-hours', r), queryFn: ({ signal }) => unwrap(api.GET('/api/analysis/seven-hours', { ...q(r), signal })), ...ranged })

export const useEnvironment = (r: Range) =>
  useQuery({ queryKey: qk.analysis('environment', r), queryFn: ({ signal }) => unwrap(api.GET('/api/analysis/environment', { ...q(r), signal })), ...ranged })

export const useSources = (r: Range) =>
  useQuery({ queryKey: qk.analysis('sources', r), queryFn: ({ signal }) => unwrap(api.GET('/api/analysis/sources', { ...q(r), signal })), ...ranged })

export const useExposures = (r: Range, key: string | null) =>
  useQuery({
    queryKey: [...qk.analysis('exposures', r), key ?? ''],
    queryFn: ({ signal }) => unwrap(api.GET('/api/analysis/exposures', { params: { query: { ...rangeQuery(r), key: key ?? undefined } }, signal })),
    ...ranged,
  })

export const useProfile = () =>
  useQuery({ queryKey: qk.profile, queryFn: ({ signal }) => unwrap(api.GET('/api/profile', { signal })), staleTime: Infinity })

/** Saving the profile changes every age- and sex-dependent figure, so their cached ranges are dropped. */
export function useSaveProfile() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: ProfileInput) => unwrap(api.PUT('/api/profile', { body })),
    onSuccess: (p) => {
      client.setQueryData(qk.profile, p)
      void client.invalidateQueries({ queryKey: ['data', 'analysis', 'fitness'] })
      void client.invalidateQueries({ queryKey: ['data', 'analysis', 'exposures'] })
    },
  })
}

export const useJournal = (r: Range) =>
  useQuery({ queryKey: qk.journal(r), queryFn: ({ signal }) => unwrap(api.GET('/api/journal', { ...q(r), signal })), ...ranged })

/** A day's entry in every cached range that holds it, kept in date order; an unreviewed day leaves the list. */
function placeDay(j: Journal, key: readonly unknown[], day: JournalDay): Journal {
  const [start, end] = String(key[1]).split('..')
  if (day.date < start || day.date >= end) return j
  const days = j.days.filter((d) => d.date !== day.date)
  if (day.answered) days.push(day)
  days.sort((a, b) => (a.date < b.date ? -1 : 1))
  return { ...j, days }
}

/** Refetch once the last queued edit lands, so a refetch never overwrites an edit still on its way. */
const journalChanged = (client: ReturnType<typeof useQueryClient>) => {
  if (client.isMutating({ mutationKey: ['journal'] }) > 1) return
  void client.invalidateQueries({ queryKey: ['journal'] })
  void client.invalidateQueries({ queryKey: ['data', 'analysis', 'exposures'] })
}

/**
 * Replace one day's entry. The calendar shows it at once and puts it back if the server refuses; edits run one at a time so
 * the last one made is the one kept. The night comparisons read the journal, so they are refetched after.
 */
export function useSaveJournalDay() {
  const client = useQueryClient()
  return useMutation({
    mutationKey: ['journal'],
    scope: { id: 'journal' },
    mutationFn: (day: JournalDay) => unwrap(api.PUT('/api/journal/{day}', { params: { path: { day: day.date } }, body: { tags: day.tags, answered: day.answered } })),
    onMutate: async (day) => {
      await client.cancelQueries({ queryKey: ['journal'] })
      const before = client.getQueriesData<Journal>({ queryKey: ['journal'] })
      for (const [key, j] of before) if (j) client.setQueryData(key, placeDay(j, key, day))
      return { before }
    },
    onError: (_e, _day, ctx) => {
      for (const [key, j] of ctx?.before ?? []) client.setQueryData(key, j)
    },
    onSettled: () => journalChanged(client),
  })
}

export function useAddJournalTag() {
  const client = useQueryClient()
  return useMutation({
    mutationKey: ['journal'],
    scope: { id: 'journal' },
    mutationFn: (label: string) => unwrap(api.POST('/api/journal/tags', { body: { label } })),
    onSuccess: (tag) => {
      for (const [key, j] of client.getQueriesData<Journal>({ queryKey: ['journal'] }))
        if (j && !j.tags.some((t) => t.key === tag.key)) client.setQueryData(key, { ...j, tags: [...j.tags, tag] })
    },
    onSettled: () => journalChanged(client),
  })
}

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

import type { ImportJob } from '@/core/domain'
import { api, raw, unwrap } from './http'

export interface UploadProgress {
  sent: number
  total: number
}

/** Create a job, stream the file in sequential chunks, then commit so the pipeline starts. */
export async function uploadExport(
  file: File,
  onProgress: (p: UploadProgress) => void,
  onJob: (job: ImportJob) => void,
): Promise<ImportJob> {
  const { job, chunk_size } = await unwrap(api.POST('/api/imports', { body: { filename: file.name, size: file.size } }))
  onJob(job)
  const chunks = Math.max(1, Math.ceil(file.size / chunk_size))
  for (let i = 0; i < chunks; i++) {
    const blob = file.slice(i * chunk_size, Math.min(file.size, (i + 1) * chunk_size))
    await raw(`/imports/${job.id}/chunks/${i}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: blob })
    onProgress({ sent: Math.min(file.size, (i + 1) * chunk_size), total: file.size })
  }
  return unwrap(api.POST('/api/imports/{job_id}/commit', { params: { path: { job_id: job.id } } }))
}

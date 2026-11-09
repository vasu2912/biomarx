import type { ImportJob, ImportState } from '@/core/domain'

export type Flow =
  | { kind: 'idle' }
  | { kind: 'uploading'; filename: string; sent: number; total: number; jobId: string | null }
  | { kind: 'processing'; job: ImportJob }
  | { kind: 'ready'; job: ImportJob }
  | { kind: 'failed'; error: string }

export const PHASES = [
  { key: 'upload', label: 'Upload' },
  { key: 'queued', label: 'Queued' },
  { key: 'parse', label: 'Parse' },
  { key: 'derive', label: 'Derive' },
  { key: 'ready', label: 'Ready' },
] as const

const PHASE_OF_STATE: Record<ImportState, number> = { uploading: 0, queued: 1, parsing: 2, deriving: 3, ready: 4, failed: -1 }

/** The active phase index, the 0..1 progress within it, and a status line. */
export function phaseOf(flow: Flow): { phase: number; progress: number; message: string; records: number | null } {
  switch (flow.kind) {
    case 'idle':
    case 'failed':
      return { phase: -1, progress: 0, message: '', records: null }
    case 'uploading':
      return { phase: 0, progress: flow.total ? flow.sent / flow.total : 0, message: `Sending ${flow.filename}`, records: null }
    case 'processing':
    case 'ready': {
      const j = flow.job
      return { phase: PHASE_OF_STATE[j.state], progress: flow.kind === 'ready' ? 1 : j.progress, message: j.message, records: j.records > 0 ? j.records : null }
    }
  }
}

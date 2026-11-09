import { useQueryClient } from '@tanstack/react-query'
import { Check, FileArchive, Lock, TriangleAlert, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import type { Dataset } from '@/core/domain'
import { compact } from '@/core/format'
import { formatRange } from '@/core/time'
import { qk, useImportJob, useStatus } from '@/infra/queries'
import { uploadExport } from '@/infra/upload'
import { Button, cn } from '@/ui/primitives'
import { PHASES, phaseOf, type Flow } from './flow'

export default function ImportPage() {
  const status = useStatus()
  const dataset = status.data?.dataset ?? null
  const [flow, setFlow] = useState<Flow>(() => {
    const active = status.data?.active_import
    return active ? { kind: 'processing', job: active } : { kind: 'idle' }
  })
  const pollId = flow.kind === 'processing' ? flow.job.id : null
  const job = useImportJob(pollId)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const j = job.data
  const live: Flow =
    flow.kind !== 'processing' || !j || j.id !== flow.job.id
      ? flow
      : j.state === 'ready'
        ? { kind: 'ready', job: j }
        : j.state === 'failed'
          ? { kind: 'failed', error: j.error ?? j.message }
          : { kind: 'processing', job: j }

  const finished = live.kind === 'ready' ? live.job : null
  const handled = useRef<string | null>(null)
  useEffect(() => {
    if (!finished || handled.current === finished.id) return
    handled.current = finished.id
    void queryClient.invalidateQueries({ queryKey: qk.status })
    void queryClient.invalidateQueries({ queryKey: qk.data })
    toast.success(`Imported ${compact(finished.records)} records`)
    void navigate('/')
  }, [finished, queryClient, navigate])

  const start = async (file: File) => {
    setFlow({ kind: 'uploading', filename: file.name, sent: 0, total: file.size, jobId: null })
    try {
      const committed = await uploadExport(
        file,
        (p) => setFlow((f) => (f.kind === 'uploading' ? { ...f, sent: p.sent, total: p.total } : f)),
        (created) => setFlow((f) => (f.kind === 'uploading' ? { ...f, jobId: created.id } : f)),
      )
      setFlow({ kind: 'processing', job: committed })
    } catch (e) {
      setFlow({ kind: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
  }

  const busy = live.kind === 'uploading' || live.kind === 'processing' || live.kind === 'ready'

  return (
    <article className="max-w-[860px]">
      <header className="mb-12 max-w-[72ch]">
        <div className="eyebrow mb-3">Import</div>
        <h1 className="display text-[44px] leading-[1.05] text-ink sm:text-[54px]">{dataset ? 'Replace the dataset' : 'Load your health export'}</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
          Biomarx reads the full Apple Health export once, then derives every night, rhythm and trend from it on this machine.
        </p>
      </header>

      <div className="space-y-10">
        {dataset && <Replaces dataset={dataset} />}
        {busy ? <Progress flow={live} /> : <DropTarget onFile={(f) => void start(f)} />}
        {live.kind === 'failed' && <Failure error={live.error} onReset={() => setFlow({ kind: 'idle' })} />}
        <Instructions />
      </div>
    </article>
  )
}

function DropTarget({ onFile }: { onFile: (f: File) => void }) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'application/zip': ['.zip'] },
    multiple: false,
    maxFiles: 1,
    onDropAccepted: ([f]) => onFile(f),
    onDropRejected: ([r]) => toast.error(r?.errors[0]?.code === 'file-invalid-type' ? 'Drop the export.zip file itself' : 'Drop a single .zip file'),
  })
  return (
    <div
      {...getRootProps()}
      className={cn(
        'flex cursor-pointer flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-14 text-center transition-colors',
        isDragActive ? 'border-core bg-core/[0.06]' : 'border-hairline-2 bg-surface hover:bg-raised',
      )}
    >
      <input {...getInputProps()} aria-label="Apple Health export.zip" />
      <Upload size={26} className="text-ink-3" aria-hidden />
      <div className="text-[15px] text-ink">{isDragActive ? 'Release to import' : 'Drop export.zip here, or click to choose it'}</div>
      <div className="text-[12.5px] text-ink-3">One .zip file, exactly as the Health app wrote it. No need to unzip.</div>
    </div>
  )
}

function Progress({ flow }: { flow: Flow }) {
  const { phase, progress, message, records } = phaseOf(flow)
  return (
    <section aria-live="polite" className="rounded-lg border border-hairline bg-surface px-6 py-6">
      <ol className="grid grid-cols-5 gap-2">
        {PHASES.map((p, i) => {
          const done = i < phase || (i === phase && flow.kind === 'ready')
          const active = i === phase && !done
          return (
            <li key={p.key} className="flex flex-col gap-2">
              <span className={cn('h-0.5 rounded-full', done ? 'bg-core' : active ? 'bg-core/50' : 'bg-hairline-2')} />
              <span className={cn('flex items-center gap-1.5 text-[12.5px]', done || active ? 'text-ink' : 'text-ink-4')}>
                {done ? <Check size={13} aria-hidden /> : <span className="num text-[10.5px]">{i + 1}</span>}
                {p.label}
              </span>
            </li>
          )
        })}
      </ol>
      <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-hairline" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <div className="h-full rounded-full bg-core transition-[width] duration-500" style={{ width: `${Math.max(2, progress * 100)}%` }} />
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-4 text-[13px]">
        <span className="text-ink-2">{message || 'Working'}</span>
        <span className="num shrink-0 text-ink-3">
          {records != null && `${records.toLocaleString('en-US')} records · `}
          {Math.round(progress * 100)}%
        </span>
      </div>
    </section>
  )
}

function Replaces({ dataset }: { dataset: Dataset }) {
  const rows = [
    { label: 'Span', value: formatRange(dataset.start, dataset.end) },
    { label: 'Records', value: dataset.records.toLocaleString('en-US') },
    { label: 'Nights', value: dataset.nights.toLocaleString('en-US') },
    { label: 'Imported', value: new Date(dataset.imported_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) },
  ]
  return (
    <section>
      <h2 className="eyebrow mb-3">Will be replaced</h2>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-hairline py-4 sm:grid-cols-4">
        {rows.map((r) => (
          <div key={r.label}>
            <dt className="text-[12px] text-ink-3">{r.label}</dt>
            <dd className="num mt-1 text-[13.5px] text-ink">{r.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[12.5px] text-ink-3">
        An export always holds your full history, so the new file replaces this dataset atomically, in a single transaction.
      </p>
    </section>
  )
}

function Failure({ error, onReset }: { error: string; onReset: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-bad/30 px-5 py-4">
      <TriangleAlert size={16} className="mt-0.5 shrink-0 text-bad" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] text-ink">The import failed</div>
        <div className="mt-1 text-[12.5px] break-words text-ink-3">{error}</div>
      </div>
      <Button variant="ghost" onClick={onReset}>
        Try again
      </Button>
    </div>
  )
}

const STEPS = [
  'Open the Health app on your iPhone.',
  'Tap your profile picture in the top right corner.',
  'Choose Export All Health Data and wait while it prepares the file.',
  'Send export.zip to this computer with AirDrop, Files or a cable, then drop it above.',
]

function Instructions() {
  return (
    <section className="grid gap-8 sm:grid-cols-[1fr_280px]">
      <div>
        <h2 className="eyebrow mb-3 flex items-center gap-2">
          <FileArchive size={13} aria-hidden /> Where the file comes from
        </h2>
        <ol className="space-y-2 text-[13.5px] text-ink-2">
          {STEPS.map((s, i) => (
            <li key={s} className="flex gap-3">
              <span className="num w-4 shrink-0 text-ink-4">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </div>
      <div>
        <h2 className="eyebrow mb-3 flex items-center gap-2">
          <Lock size={13} aria-hidden /> Stays on this machine
        </h2>
        <p className="text-[13px] leading-relaxed text-ink-2">
          The file goes only to the Biomarx server running on this computer. Nothing is sent to a cloud service or leaves the machine.
        </p>
      </div>
    </section>
  )
}

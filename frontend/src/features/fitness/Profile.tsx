import { useState } from 'react'
import type { Profile } from '@/core/domain'
import { useSaveProfile } from '@/infra/queries'
import { Button, cn, Segmented } from '@/ui/primitives'

type Sex = 'male' | 'female'
const SEXES = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
] as const satisfies readonly { value: Sex; label: string }[]

/** The server refuses dates in the future; the input stops there too. */
const TODAY = new Date().toISOString().slice(0, 10)

export const knownSex = (p: Profile | undefined): Sex | null => (p?.sex === 'male' || p?.sex === 'female' ? p.sex : null)

/**
 * Birth date and sex, saved to the server. A field left as the export gave it is sent as null, so it keeps following the export.
 * This is the only place the birth date is ever shown.
 */
export function ProfileForm({ profile, prompt, boxed = true, onDone }: { profile: Profile | undefined; prompt: string; boxed?: boolean; onDone?: () => void }) {
  const [birth, setBirth] = useState(profile?.birth_date ?? '')
  const [sex, setSex] = useState<Sex | null>(knownSex(profile))
  const save = useSaveProfile()
  const fromExport = (k: 'birth_date' | 'sex', v: string | null) => profile?.source[k] === 'export' && profile[k] === v
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    save.mutate(
      { birth_date: birth && !fromExport('birth_date', birth) ? birth : null, sex: sex && !fromExport('sex', sex) ? sex : null },
      { onSuccess: () => onDone?.() },
    )
  }
  return (
    <form onSubmit={submit} className={cn(boxed && 'rounded-md border border-hairline bg-white/[0.015] px-5 py-6')}>
      <p className="mb-3 max-w-[64ch] text-[13px] leading-relaxed text-ink-2">{prompt}</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[12px] text-ink-3">
          Birth date
          <input
            type="date"
            value={birth}
            min="1900-01-01"
            max={TODAY}
            onChange={(e) => setBirth(e.target.value)}
            className="num h-8 rounded-md border border-hairline-2 bg-sunken px-2.5 text-[12.5px] text-ink [color-scheme:dark] hover:border-ink-4"
          />
        </label>
        <span className="flex items-center gap-2 text-[12px] text-ink-3">
          Sex
          <Segmented value={sex} onChange={setSex} options={SEXES} label="Sex" />
        </span>
        <Button type="submit" className="!h-8" disabled={save.isPending || (!birth && !sex)}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
        {onDone && (
          <Button type="button" variant="quiet" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
      {save.isError && <p className="mt-2 text-[12px] text-bad">{save.error.message}</p>}
      <p className="mt-3 text-[11.5px] text-ink-3">Kept on this machine beside the database; a new import never replaces it.</p>
    </form>
  )
}

const SOURCE = { export: 'from your export', user: 'entered by you' } as const

/** “Age 36 · male · from your export · edit”, under the chapter lede once anything is known. */
export function ProfileLine({ profile }: { profile: Profile | undefined }) {
  const [editing, setEditing] = useState(false)
  if (!profile || (profile.age == null && !knownSex(profile))) return null
  const sources = [...new Set([profile.source.birth_date, profile.source.sex].filter((s) => s != null))]
  const parts = [profile.age != null ? `Age ${profile.age}` : 'Age not set', knownSex(profile) ?? 'sex not set', sources.map((s) => SOURCE[s]).join(' and ')]
  return (
    <div className="mt-4">
      <p className="num text-[12px] text-ink-3">
        {parts.filter(Boolean).join(' · ')} ·{' '}
        <button type="button" onClick={() => setEditing((v) => !v)} className="text-ink-2 underline decoration-hairline-2 underline-offset-[3px] transition-colors hover:text-ink">
          edit
        </button>
      </p>
      {editing && (
        <div className="mt-4">
          <ProfileForm profile={profile} prompt="Heart-rate zones and training load use your age and sex." onDone={() => setEditing(false)} />
        </div>
      )}
    </div>
  )
}

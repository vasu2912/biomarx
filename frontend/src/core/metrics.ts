import { SIGNAL } from './color'
import type { MetricDef } from './domain'

/**
 * Metric keys the chapters read. Labels, units, decimals and direction come from the backend
 * registry (GET /metrics); this table only names the keys so a rename is one edit.
 */
export const K = {
  steps: 'steps',
  activeKcal: 'active_kcal',
  onset: 'onset_h',
  mid: 'mid_h',
  offset: 'offset_h',
  tst: 'tst',
  eff: 'eff',
  tib: 'tib',
  deepH: 'deep_h',
  coreH: 'core_h',
  remH: 'rem_h',
  waso: 'waso',
  deepPct: 'deep_pct',
  remPct: 'rem_pct',
  nightHr: 'night_hr',
  dayHr: 'day_hr',
  dip: 'dip',
  hrv: 'hrv',
  rhr: 'rhr_next',
  nightHrMin: 'night_hr_min',
  spo2P5: 'spo2_p5',
  spo2: 'spo2',
  resp: 'resp',
  sri: 'sri',
  mesor: 'hr_mesor',
  amp: 'hr_amp',
  acro: 'hr_acro',
  r2: 'hr_r2',
  isSteps: 'is_steps',
  ivSteps: 'iv_steps',
  raSteps: 'ra_steps',
  isHr: 'is_hr',
  ivHr: 'iv_hr',
  raHr: 'ra_hr',
  m10On: 'm10_on',
  l5On: 'l5_on',
  walkSpeed: 'walking_speed',
  stepLength: 'step_length',
  doubleSupport: 'double_support',
  asymmetry: 'asymmetry',
  wear: 'wear',
} as const

export type Registry = Map<string, MetricDef>

export const buildRegistry = (defs: readonly MetricDef[]): Registry => new Map(defs.map((d) => [d.key, d]))

export function def(reg: Registry, key: string): MetricDef {
  return reg.get(key) ?? { key, label: key, unit: '', decimals: 1, direction: 'neutral', group: 'activity', description: '', clock: false }
}

/** The signal color a metric draws in, by what it measures. */
export const METRIC_COLOR: Record<string, string> = {
  steps: SIGNAL.sun,
  active_kcal: SIGNAL.sun,
  onset_h: SIGNAL.onset,
  mid_h: SIGNAL.mid,
  offset_h: SIGNAL.wake,
  tst: SIGNAL.core,
  eff: SIGNAL.core,
  deep_pct: SIGNAL.deep,
  rem_pct: SIGNAL.rem,
  waso: SIGNAL.awake,
  night_hr: SIGNAL.cool,
  day_hr: SIGNAL.ember,
  dip: SIGNAL.rem,
  hrv: SIGNAL.hrv,
  rhr_next: SIGNAL.ember,
  spo2: SIGNAL.spo2,
  resp: SIGNAL.resp,
  sri: SIGNAL.hrv,
  hr_mesor: SIGNAL.ember,
  hr_amp: SIGNAL.sun,
  hr_acro: SIGNAL.hrv,
  hr_r2: SIGNAL.rem,
  walking_speed: SIGNAL.cool,
  step_length: SIGNAL.rem,
  double_support: SIGNAL.sun,
  asymmetry: SIGNAL.onset,
}

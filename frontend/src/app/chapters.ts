import { SIGNAL } from '@/core/color'
import { K } from '@/core/metrics'

export interface Chapter {
  n: string
  path: string
  title: string
  kicker: string
  /** the metric whose weekly trace becomes the rail glyph; null draws the static pulse glyph */
  spark: string | null
  color: string
}

export const CHAPTERS: readonly Chapter[] = [
  { n: '01', path: '/', title: 'Overview', kicker: 'The instrument at a glance', spark: K.tst, color: SIGNAL.core },
  { n: '02', path: '/sleep', title: 'Sleep', kicker: 'Timing, depth, regularity', spark: K.onset, color: SIGNAL.deep },
  { n: '03', path: '/rhythm', title: 'Rhythm', kicker: 'The circadian signal', spark: K.amp, color: SIGNAL.sun },
  { n: '04', path: '/heart', title: 'Heart', kicker: 'Nocturnal physiology', spark: K.rhr, color: SIGNAL.ember },
  { n: '05', path: '/patterns', title: 'Patterns', kicker: 'What moves together', spark: K.hrv, color: SIGNAL.hrv },
  { n: '06', path: '/mobility', title: 'Mobility', kicker: 'Gait, the sixth vital sign', spark: K.walkSpeed, color: SIGNAL.cool },
  { n: '07', path: '/ecg', title: 'ECG', kicker: 'Single-lead recordings', spark: null, color: SIGNAL.awake },
]

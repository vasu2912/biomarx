import type { components } from './api.gen'
import type { IsoDate } from './time'

type S = components['schemas']

export type Dataset = S['DatasetOut']
export type ImportJob = S['ImportJobOut']
export type ImportState = S['ImportState']
export type Status = S['StatusOut']
export type MetricDef = S['MetricOut']
export type Direction = S['Direction']
export type Daily = S['DailyOut']
export type Nights = S['NightsOut']
export type Summary = S['SummaryOut']
export type Architecture = S['ArchitectureOut']
export type Chronotype = S['ChronotypeOut']
export type Periodogram = S['PeriodogramOut']
export type Correlation = S['CorrelationOut']
export type StateMatrix = S['StateOut']
export type HrActivity = S['HrActivityOut']
export type EcgSummary = S['EcgSummaryOut']
export type EcgDetail = S['EcgDetailOut']
export type CreateImport = S['CreateImportOut']

export type Column = (number | null)[]

export const IMPORT_STATES = ['uploading', 'queued', 'parsing', 'deriving', 'ready', 'failed'] as const satisfies readonly ImportState[]

export interface Raster<T extends Uint8Array | Float32Array = Uint8Array | Float32Array> {
  rows: number
  cols: number
  start: IsoDate
  data: T
}

export interface Range {
  start: IsoDate
  /** exclusive */
  end: IsoDate
}

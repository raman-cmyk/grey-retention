export const recordStatuses = [
  'pending',
  'active',
  'suspended',
  'archived'
] as const

export type RecordStatus = (typeof recordStatuses)[number]

export const operationStatuses = [
  'idle',
  'pending',
  'succeeded',
  'failed'
] as const

export type OperationStatus = (typeof operationStatuses)[number]

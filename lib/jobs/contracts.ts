export const jobStatuses = [
  'queued',
  'leased',
  'running',
  'retry_wait',
  'succeeded',
  'failed',
  'cancelled'
] as const

export type JobStatus = (typeof jobStatuses)[number]

export type JobReference = {
  id: string
  kind: string
  status: JobStatus
}

export type JobProgress = {
  processed: number
  total: number | null
  cursor: string | null
  message?: string
}

export type RetryPolicy = {
  maxAttempts: number
  initialDelayMs: number
  maximumDelayMs: number
  multiplier: number
  jitterRatio: number
}

export type JobFailure = {
  code: string
  message: string
  retryable: boolean
}

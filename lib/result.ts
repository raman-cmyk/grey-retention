export type Success<T, TMeta = Record<string, never>> = {
  ok: true
  data: T
  meta?: TMeta & { requestId?: string }
}

export type Failure = {
  ok: false
  error: {
    code: string
    message: string
    fieldErrors?: Record<string, string[]>
    retryable?: boolean
  }
  meta: { requestId: string }
}

export type Result<T, TMeta = Record<string, never>> =
  Success<T, TMeta> | Failure

export function success<T, TMeta = Record<string, never>>(
  data: T,
  meta?: TMeta & { requestId?: string }
): Success<T, TMeta> {
  return { ok: true, data, ...(meta ? { meta } : {}) }
}

export function failure(input: {
  code: string
  message: string
  requestId: string
  fieldErrors?: Record<string, string[]>
  retryable?: boolean
}): Failure {
  const { requestId, ...error } = input
  return { ok: false, error, meta: { requestId } }
}

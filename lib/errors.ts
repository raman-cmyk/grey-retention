export class AppError extends Error {
  readonly code: string
  readonly status: number
  readonly retryable: boolean

  constructor(options: {
    code: string
    message: string
    status?: number
    retryable?: boolean
    cause?: unknown
  }) {
    super(options.message, { cause: options.cause })
    this.name = 'AppError'
    this.code = options.code
    this.status = options.status ?? 500
    this.retryable = options.retryable ?? false
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

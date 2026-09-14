import 'server-only'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type LogContext = Record<string, boolean | number | string | null | undefined>

const blockedKeys =
  /authorization|cookie|credential|password|prompt|secret|token/i

function sanitize(context: LogContext): LogContext {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      blockedKeys.test(key) ? '[REDACTED]' : value
    ])
  )
}

function write(level: LogLevel, message: string, context: LogContext = {}) {
  const payload = JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...sanitize(context)
  })

  if (level === 'error') console.error(payload)
  else if (level === 'warn') console.warn(payload)
  else console.log(payload)
}

export const logger = {
  debug: (message: string, context?: LogContext) =>
    write('debug', message, context),
  info: (message: string, context?: LogContext) =>
    write('info', message, context),
  warn: (message: string, context?: LogContext) =>
    write('warn', message, context),
  error: (message: string, context?: LogContext) =>
    write('error', message, context)
}

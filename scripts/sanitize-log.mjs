/** Redact expiring preview capabilities and bearer-shaped credentials before any test output leaves the process. */
export function sanitizeLog(line) {
  return line
    .replace(/((?:[?&]|&amp;)token=)[^&"'\s<>]+/g, '$1[REDACTED]')
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      '[REDACTED]'
    )
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
}

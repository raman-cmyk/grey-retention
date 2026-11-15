import { timingSafeEqual } from 'node:crypto'
/**
 * The scheduler's call carries the shared secret. Spaces and line breaks
 * at either end of either copy are ignored (CI-005: a pasted secret's
 * trailing line break stopped every scheduled call).
 */
export function cronAuthorized(
  header: string | null,
  secret: string | undefined
) {
  const want = secret?.trim()
  if (!want || want.length < 32 || !header?.startsWith('Bearer ')) return false
  const provided = Buffer.from(header.slice(7).trim()),
    expected = Buffer.from(want)
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  )
}
/**
 * The scheduled sweep only has fixture adapters. An unset mode is fake (the
 * environment default); `real` or any unknown value is refused.
 */
export function scheduledDispatchAllowed(mode: string | undefined) {
  return (mode ?? 'fake') === 'fake'
}
export function localFixtureDispatch(
  mode: string | undefined,
  url: string | undefined
) {
  if (mode !== 'fake' || !url) return false
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'http:' &&
      ['127.0.0.1', 'localhost'].includes(parsed.hostname)
    )
  } catch {
    return false
  }
}

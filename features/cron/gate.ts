import { timingSafeEqual } from 'node:crypto'
export function cronAuthorized(
  header: string | null,
  secret: string | undefined
) {
  if (!secret || secret.length < 32 || !header?.startsWith('Bearer '))
    return false
  const provided = Buffer.from(header.slice(7)),
    expected = Buffer.from(secret)
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  )
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

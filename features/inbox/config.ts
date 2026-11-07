import 'server-only'
import type { InboundCaptureTransport } from '@/lib/providers/inbound-capture'
import { fakeInboundTransport } from './fake-transport'
import { gmailImapTransport } from './imap'

export type InboxConfig =
  | { ready: true; transport: InboundCaptureTransport }
  | { ready: false; kind: 'gmail_imap'; reason: string }

type Env = Record<string, string | undefined>

/** True for a Supabase URL on this machine (local development and tests). */
function localDatabase(url: string | undefined) {
  try {
    return ['127.0.0.1', 'localhost', '[::1]'].includes(
      new URL(url ?? '').hostname
    )
  } catch {
    return false
  }
}

/**
 * Which inbox the worker reads, from the server environment only. Gmail is
 * read when both `INBOX_IMAP_USER` and `INBOX_IMAP_APP_PASSWORD` (a Google
 * app password) are set; otherwise the sample inbox. Against a local
 * database (a developer machine or a Claude session) Gmail also needs
 * `INBOX_TRANSPORT=gmail_imap`, so copied production values never read the
 * real inbox by accident. `INBOX_TRANSPORT=fake` always forces the sample
 * inbox. The
 * values are never logged, returned or shown; a missing or malformed one
 * gives a reason in words.
 */
export function inboxConfig(env: Env = process.env): InboxConfig {
  const kind = (env.INBOX_TRANSPORT ?? '').trim()
  const rawUser = (env.INBOX_IMAP_USER ?? '').trim()
  const rawPassword = env.INBOX_IMAP_APP_PASSWORD ?? ''
  if (kind !== '' && kind !== 'fake' && kind !== 'gmail_imap')
    return {
      ready: false,
      kind: 'gmail_imap',
      reason: 'INBOX_TRANSPORT must be "fake" or "gmail_imap".'
    }
  if (
    kind === 'fake' ||
    (kind === '' &&
      ((!rawUser && !rawPassword.trim()) ||
        localDatabase(env.NEXT_PUBLIC_SUPABASE_URL)))
  )
    return { ready: true, transport: fakeInboundTransport() }
  const user = rawUser.toLowerCase()
  // Google shows app passwords in groups of four; the spaces are not part of it.
  const password = rawPassword.replace(/\s+/g, '')
  if (!/^[^@\s]+@(gmail|googlemail)\.com$/.test(user))
    return {
      ready: false,
      kind: 'gmail_imap',
      reason: 'INBOX_IMAP_USER must be the Gmail address of the inbox.'
    }
  if (!/^[a-z]{16}$/i.test(password))
    return {
      ready: false,
      kind: 'gmail_imap',
      reason: 'INBOX_IMAP_APP_PASSWORD must be a 16-letter Google app password.'
    }
  return { ready: true, transport: gmailImapTransport({ user, password }) }
}

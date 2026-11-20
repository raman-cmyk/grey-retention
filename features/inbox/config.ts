import 'server-only'
import type { InboundCaptureTransport } from '@/lib/providers/inbound-capture'
import { fakeInboundTransport } from './fake-transport'
import { gmailImapTransport } from './imap'

export type InboxConfig = (
  | { ready: true; transport: InboundCaptureTransport }
  | { ready: false; kind: 'gmail_imap'; reason: string }
) & {
  /** The names the inbox subscribed with (`INBOX_SUBSCRIBER_NAMES`). */
  subscriberNames?: string[]
  /**
   * The inbox's own address from `INBOX_IMAP_USER`, also while the inbox
   * cannot be read, so the privacy cleaner always knows it.
   */
  inboxAddresses?: string[]
  /** Hosts of picture services that draw the subscriber into a picture. */
  imageHosts?: string[]
}

/**
 * REAL-1b1: services that draw a picture for each subscriber (their name,
 * a countdown made for them), so a stored copy may show the person. Every
 * picture from these hosts or their subdomains is hidden; `*` stands for
 * any letters, digits or hyphens. Written from what the services are known
 * to use; extend the list when another one shows up in the inbox.
 */
export const personalisedImageHosts: readonly string[] = Object.freeze([
  // NiftyImages.
  'niftyimages.com',
  // Movable Ink (its own hosts and its numbered ones).
  'movableink.com',
  'movable-ink-*.com',
  // Kickdynamic, now Litmus Personalize.
  'kickdynamic.com',
  'kickdynamic.net',
  'litmus.com',
  // Liveclicker.
  'liveclicker.com',
  'liveclicker.net',
  // Zembula.
  'zembula.com',
  // Spotler.
  'spotler.com',
  'spotler.co.uk',
  'spotler.nl',
  // Hyperise and MotionMail draw names into pictures too.
  'hyperise.io',
  'hyperise.com',
  'motionmailapp.com'
])

type Env = Record<string, string | undefined>

/**
 * REAL-1b1: `INBOX_SUBSCRIBER_NAMES` (optional, not secret) lists the names
 * the inbox subscribed to newsletters with, comma separated (e.g. "Sam
 * Rivera, Sam"), so the privacy cleaner removes them from real brands'
 * emails wherever they appear. Use a persona's name, never a common word
 * ("Rose", "May"): every whole-word copy of it is removed. A name is read
 * one way only: in any case, also without an accent or ß it has ("José"
 * also goes as "jose", "Strauß" as "STRAUSS"), but never with one it
 * lacks ("Noel" keeps "Noël", "Weiss" keeps "Weiß"), and never in a word
 * of another script ("Tom" keeps the Russian "том"); only a word that
 * mixes scripts is read as a disguise. Arabic vowel signs, Hebrew points
 * and marks that only decorate a letter never matter. A name word is
 * also found glued to other text: at a digit ("SAM20", "20SAM"), where a
 * small letter meets a capital ("HappyBirthdaySam", "#SamStyle"), in
 * capitals with up to three more ("SAMVIP"), and the name with its words
 * run together in any case ("samrivera"). Write it with its accents. At
 * most 20 names of 2 to 100 characters; never logged.
 */
export function subscriberNames(env: Env = process.env) {
  return (env.INBOX_SUBSCRIBER_NAMES ?? '')
    .normalize('NFC')
    .split(',')
    .map((n) => n.replace(/\s+/g, ' ').trim())
    .filter((n) => n.length >= 2 && n.length <= 100)
    .slice(0, 20)
}

/** The inbox to read (see `inboxTransport`), its address and its names. */
export function inboxConfig(env: Env = process.env): InboxConfig {
  const user = (env.INBOX_IMAP_USER ?? '').trim().toLowerCase()
  return {
    ...inboxTransport(env),
    subscriberNames: subscriberNames(env),
    inboxAddresses: /^[^@\s]+@[^@\s]+$/.test(user) ? [user] : [],
    imageHosts: [...personalisedImageHosts]
  }
}

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
function inboxTransport(env: Env): InboxConfig {
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

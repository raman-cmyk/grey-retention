import { z } from 'zod'

/** The first word of a profile name, or "there" ("Hi there"). */
export function firstName(fullName: string | null | undefined) {
  const first = (fullName ?? '').trim().split(/\s+/)[0] ?? ''
  return first || 'there'
}

/**
 * The first assistant message of every thread (spec §8). It is shown, not
 * stored, so each viewer sees their own name. The workspace runs on sample
 * data, so it says so instead of "your store's data".
 */
export function greeting(name: string, assistant = 'GROS') {
  return `Hi ${name} — I'm ${assistant}, your marketing assistant. I've got your workspace's campaigns in front of me (sample data for now), so I can tell you where they stand, what was sent last and what is waiting for approval. Answers to other questions are coming soon.\n\nWhat's on your mind?`
}

/**
 * Suggested first questions in a new chat (OWNER_JOURNEYS §8): ones GROS
 * can answer today from the workspace's own campaigns.
 */
export const starterQuestions = [
  'What did I send last?',
  'What is waiting for my approval?',
  'When is my next planned send?'
] as const

const day = 86_400_000

/** "today", "yesterday", "5 days ago", "3 months ago". */
export function agoText(iso: string, nowMs: number) {
  const days = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / day))
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 60) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 24) return `${months} months ago`
  return `${Math.floor(days / 365)} years ago`
}

/** The muted line under a thread title: "5 msg · 2 days ago". */
export function threadMeta(
  thread: {
    message_count: number
    last_message_at: string | null
    created_at: string
  },
  nowMs: number
) {
  return `${thread.message_count} msg · ${agoText(thread.last_message_at ?? thread.created_at, nowMs)}`
}

/** Who can read a chat, in plain words, for its creator or a teammate. */
export function visibilityText(
  visibility: 'private' | 'shared',
  mine: boolean
) {
  if (visibility === 'private') return 'Only you can see this chat.'
  return mine
    ? 'Everyone in your workspace team can read this chat. Only you can rename, delete or make it private again.'
    : 'Everyone in your workspace team can read this chat. Only the person who started it can rename, delete or make it private.'
}

/**
 * ⌘+Enter (Mac) or Ctrl+Enter sends; plain Enter adds a line. Never while
 * an input method is still composing a word.
 */
export function isSendKey(event: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  isComposing?: boolean
  keyCode?: number
}) {
  return (
    event.key === 'Enter' &&
    (event.metaKey || event.ctrlKey) &&
    !event.isComposing &&
    event.keyCode !== 229
  )
}

export function validChatId(value: unknown) {
  return z.uuid().safeParse(value).success ? (value as string) : undefined
}

export function validMessageCursor(value: unknown) {
  const parsed = z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/** Messages per page; older ones are behind "Earlier messages". */
export const messagePage = 50

import { z } from 'zod'

/** The four request types of the old app (OWNER_JOURNEYS §15). */
export const categories = [
  {
    value: 'feature',
    label: 'Feature Request',
    help: 'Something new you would like.'
  },
  {
    value: 'improvement',
    label: 'Improve Existing',
    help: 'Make something better.'
  },
  { value: 'bug', label: 'Bug', help: 'Something is broken.' },
  { value: 'general', label: 'General Feedback', help: 'Anything else.' }
] as const
export type Category = (typeof categories)[number]['value']
export const categoryLabel = Object.fromEntries(
  categories.map((c) => [c.value, c.label])
) as Record<Category, string>

/**
 * The status the owner sees, from the ticket state the platform team sets:
 * open = Open, in_progress = Planned, closed = Done.
 */
export type RequestStatus = 'open' | 'planned' | 'done'
export const statusLabel: Record<RequestStatus, string> = {
  open: 'Open',
  planned: 'Planned',
  done: 'Done'
}
export function statusOf(state: string): RequestStatus {
  if (state === 'in_progress') return 'planned'
  if (state === 'closed') return 'done'
  return 'open'
}

export type Reply = {
  id: string
  author: string
  /** From the platform team (not a workspace member). */
  fromTeam: boolean
  body: string
  createdAt: string
}
export type FeatureRequest = {
  id: string
  subject: string
  category: Category | null
  status: RequestStatus
  createdAt: string
  by: string
  details: string
  replies: Reply[]
}

const length = (text: string) => [...text].length
/** Control characters, as Postgres `[[:cntrl:]]` sees them (C0, DEL, C1). */
const hasControl = (text: string) =>
  [...text].some((c) => {
    const code = c.codePointAt(0)!
    return code < 32 || (code >= 127 && code <= 159)
  })
const trimDetails = (text: string) =>
  text.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')

/** The modal's form, with the same limits as `request_feature`. */
export const requestSchema = z.object({
  category: z.enum(
    categories.map((c) => c.value) as [Category, ...Category[]],
    'Choose a type.'
  ),
  subject: z
    .string()
    .trim()
    .refine((v) => length(v) >= 2, 'Subject: at least 2 characters.')
    .refine((v) => length(v) <= 200, 'Subject: at most 200 characters.')
    .refine((v) => !hasControl(v), 'Subject: use one line of text.'),
  details: z
    .string()
    .transform((v) => trimDetails(v.replace(/\r\n/g, '\n')))
    .refine((v) => length(v) >= 1, 'Details: tell us a little more.')
    .refine((v) => length(v) <= 5000, 'Details: at most 5000 characters.')
})

/** True when both fields have something in them (Send is enabled). */
export const readyToSend = (subject: string, details: string) =>
  subject.trim().length > 0 && details.trim().length > 0

/** Search over subject, details and replies, ignoring case. */
export function matches(request: FeatureRequest, query: string) {
  const q = query.trim().toLocaleLowerCase()
  if (!q) return true
  return [
    request.subject,
    request.details,
    ...request.replies.map((r) => r.body)
  ]
    .join('\n')
    .toLocaleLowerCase()
    .includes(q)
}

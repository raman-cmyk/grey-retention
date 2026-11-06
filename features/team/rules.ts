import { z } from 'zod'

/**
 * Team roles. The database keeps 'admin'; the page calls it **Manager** so
 * it never clashes with the platform admins who review designs
 * (OWNER_JOURNEYS §18 decision 17).
 */
export type TeamRole = 'owner' | 'admin' | 'staff'
export type AssignableRole = Exclude<TeamRole, 'owner'>

export const roleLabel: Record<TeamRole, string> = {
  owner: 'Owner',
  admin: 'Manager',
  staff: 'Staff'
}
export const assignableRoles: { value: AssignableRole; label: string }[] = [
  { value: 'staff', label: 'Staff' },
  { value: 'admin', label: 'Manager' }
]
export const roleHelp: Record<AssignableRole, string> = {
  admin:
    'Managers can invite people, change their access and see reports and usage.',
  staff: 'Staff work on campaigns but cannot manage the team.'
}
/** Owner approval is never delegated (AGENTS.md). */
export const ownerOnlyNote =
  'Only the owner approves copy, designs and sending.'

export type TeamMember = {
  id: string
  name: string
  email: string
  role: TeamRole
  status: 'active' | 'inactive'
  updatedAt: string
  isMe: boolean
}
export type PendingInvite = {
  id: string
  email: string
  role: AssignableRole
  expiresAt: string
}

/** Who may invite people and change access (the database checks again). */
export const canManageTeam = (role: string) =>
  role === 'owner' || role === 'admin'

/** Like the database: something@something.something, no spaces or controls. */
const emailPattern = /^[^@\s\p{Cc}]+@[^@\s\p{Cc}]+\.[^@\s\p{Cc}]+$/u

export const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'Enter their email address.')
    .max(254, 'That email address is too long.')
    .regex(emailPattern, 'Enter an email address like name@company.com.'),
  role: z.enum(['admin', 'staff'], 'Choose Staff or Manager.')
})

export const memberChangeSchema = z.object({
  id: z.uuid(),
  updatedAt: z.string().min(1),
  role: z.enum(['admin', 'staff']),
  status: z.enum(['active', 'inactive'])
})

/** The letter in the round avatar: the name's first, else the email's. */
export function initial(member: { name: string; email: string }) {
  const first = [...(member.name.trim() || member.email.trim())][0] ?? '?'
  return first.toLocaleUpperCase('en-US')
}

/** "Expires in 6 days", "Expires today", "Expired". */
export function expiryText(expiresAt: string, now: number) {
  const left = Date.parse(expiresAt) - now
  if (!(left > 0)) return 'Expired'
  const days = Math.floor(left / 86_400_000)
  if (days === 0) return 'Expires today'
  return `Expires in ${days} day${days === 1 ? '' : 's'}`
}

export const isExpired = (expiresAt: string, now: number) =>
  !(Date.parse(expiresAt) - now > 0)

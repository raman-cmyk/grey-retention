import { notFound } from 'next/navigation'

/**
 * Decision D3 (docs/BUILD_BRIEF.md §3, issue RET-001): there is no human
 * designer. The AI builds every email from coded blocks, and today's
 * automatic render path makes the design the owner approves. The designer
 * desk, brief page, designer sign-in and the admin Designers page stay in
 * the code (and their tables stay in the database), but every one of those
 * routes answers Not found.
 */
export function retiredDesignerRoute(): void {
  notFound()
}

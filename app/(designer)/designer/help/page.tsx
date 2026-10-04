import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { PageHeading, Panel } from '@/components/ui/workspace'
import { Button } from '@/components/ui/button'

export default function DesignerHelpPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeading
        title="Designer help"
        description="From an approved brief to the brand owner’s final review."
        action={
          <Button asChild variant="secondary">
            <Link href="/designer/dashboard">
              View assignments
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        }
      />
      <Panel title="Your assignment workflow">
        <ol className="divide-y divide-[var(--line)]">
          {[
            [
              'Review the brief',
              'Open an assignment to inspect the approved copy, brand context and permitted assets. You can access the work assigned to you.'
            ],
            [
              'Submit your design',
              'Upload the requested design file from the assignment and add notes for the brand owner. Your submission is tied to the current approved copy and design revision.'
            ],
            [
              'Respond to section feedback',
              'Read the owner’s requested changes and submit a new version. Previous submissions and feedback stay in the review history.'
            ],
            [
              'Wait for owner approval',
              'The brand owner approves the exact final design version. Platform admins manage assignments, due dates and escalations.'
            ]
          ].map(([title, body], index) => (
            <li key={title} className="flex gap-4 py-5 first:pt-0 last:pb-0">
              <span
                className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--surface-hover)] text-xs font-semibold tabular-nums"
                aria-hidden
              >
                {index + 1}
              </span>
              <div>
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="mt-2 max-w-[65ch] text-sm leading-6 text-[var(--text-muted)]">
                  {body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  )
}

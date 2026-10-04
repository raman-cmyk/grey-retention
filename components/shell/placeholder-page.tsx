import { ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { StatusMark } from '@/components/ui/status-mark'

export function PlaceholderPage({
  title,
  description
}: {
  title: string
  description: string
}) {
  return (
    <section className="mx-auto max-w-6xl py-3">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 max-w-[65ch] text-sm leading-6 text-[var(--text-muted)]">
          {description}
        </p>
        <div className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] p-6">
          <StatusMark tone="warning">Planned area</StatusMark>
          <p className="mt-4 text-sm leading-6 text-[var(--text-muted)]">
            This area is still being built. Packages, provider health and job
            diagnostics are available in Operations.
          </p>
          <Button asChild variant="secondary" className="mt-5">
            <Link href="/admin/operations">
              Open operations <ArrowUpRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  )
}

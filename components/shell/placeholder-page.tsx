import { ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function PlaceholderPage({
  title,
  description
}: {
  title: string
  description: string
}) {
  return (
    <section className="mx-auto flex min-h-[65vh] max-w-5xl items-center">
      <div className="max-w-2xl">
        <h1 className="font-[family-name:var(--font-display)] text-4xl leading-[0.98] font-bold tracking-[-0.035em] sm:text-6xl">
          {title}
        </h1>
        <p className="mt-5 max-w-[65ch] text-base leading-7 text-[var(--text-muted)]">
          {description}
        </p>
        <div className="mt-8 flex gap-3">
          <Button>
            Continue setup <ArrowUpRight className="size-4" aria-hidden />
          </Button>
          <Button variant="secondary">View build plan</Button>
        </div>
      </div>
    </section>
  )
}

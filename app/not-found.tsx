import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--surface)] px-6 text-[var(--text)]">
      <div className="max-w-lg text-center">
        <p className="font-[family-name:var(--font-data)] text-xs text-[var(--text-faint)]">
          404 / MISFILED PROOF
        </p>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-5xl font-bold tracking-[-0.035em]">
          Nothing is pinned here.
        </h1>
        <p className="mt-4 leading-7 text-[var(--text-muted)]">
          Route does not exist or moved to another workspace.
        </p>
        <Button asChild className="mt-8">
          <Link href="/dashboard">Return to workspace</Link>
        </Button>
      </div>
    </main>
  )
}

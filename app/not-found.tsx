import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--nav)] px-6 text-white">
      <div className="max-w-lg text-center">
        <p className="font-[family-name:var(--font-data)] text-xs text-white/55">
          404 / MISFILED PROOF
        </p>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-5xl font-bold tracking-[-0.035em]">
          Nothing is pinned here.
        </h1>
        <p className="mt-4 leading-7 text-white/65">
          Route does not exist or moved to another workspace.
        </p>
        <Button asChild className="mt-8">
          <Link href="/dashboard">Return to workspace</Link>
        </Button>
      </div>
    </main>
  )
}

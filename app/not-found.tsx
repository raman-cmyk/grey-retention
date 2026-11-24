import { ButtonLink } from '@/components/gros/button'
import { grosRoot } from '@/components/gros/font'
import { EmptyState } from '@/components/gros/states'

/**
 * The app's Not found page (UI-AUTH), for every address no page serves
 * and every retired one (the proxy answers those with a 404 here): the
 * GROS empty state on the mist page, a title and one button to Home.
 */
export default function NotFound() {
  return (
    <div
      className={grosRoot(
        'flex min-h-dvh items-center justify-center px-[var(--space-6)] py-[var(--space-12)]'
      )}
    >
      <main className="w-full max-w-[640px]">
        <EmptyState
          title="Page not found"
          action={<ButtonLink href="/home" label="Back to Home" />}
        />
      </main>
    </div>
  )
}

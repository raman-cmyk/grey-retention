import Link from 'next/link'
import { Lock, Plus, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GrosThreadRow } from './data'
import { threadMeta } from './model'

function Threads({
  threads,
  activeId,
  nowMs
}: {
  threads: GrosThreadRow[]
  activeId: string | null
  nowMs: number
}) {
  if (!threads.length)
    return (
      <p className="px-4 py-3 text-sm text-[var(--text-muted)]">
        No chats yet. Ask GROS something to start one.
      </p>
    )
  return (
    <nav aria-label="Chats">
      <ul className="space-y-0.5 p-2">
        {threads.map((t) => {
          const active = t.id === activeId
          return (
            <li key={t.id}>
              <Link
                href={`/gros/${t.id}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative block rounded-[var(--radius-control)] px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]',
                  active
                    ? 'bg-[var(--brand-soft)] before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-[var(--brand-secondary)]'
                    : 'hover:bg-[var(--surface-hover)]'
                )}
              >
                <span className="block truncate font-semibold">{t.title}</span>
                <span className="mt-0.5 flex items-center gap-1 text-xs text-[var(--text-muted)]">
                  {t.visibility === 'private' && (
                    <>
                      <Lock className="size-3" aria-hidden="true" />
                      <span className="sr-only">Private · </span>
                    </>
                  )}
                  {t.visibility === 'shared' && (
                    <span className="sr-only">Shared · </span>
                  )}
                  {threadMeta(t, nowMs)}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/**
 * The left pane (spec §8): "✦ Ask GROS" with a round + for a new private
 * chat, the thread list (newest first) and the library count. On a phone
 * the list folds into "Your chats".
 */
export function ThreadList({
  threads,
  activeId,
  templates,
  nowMs
}: {
  threads: GrosThreadRow[]
  activeId: string | null
  templates: number
  nowMs: number
}) {
  const footer = (
    <p className="border-t border-[var(--line)] px-4 py-3 text-xs text-[var(--text-muted)]">
      GROS knows {templates} of your email{' '}
      {templates === 1 ? 'template' : 'templates'}.
    </p>
  )
  return (
    <aside
      aria-label="Your chats"
      className="flex min-h-0 flex-col border-b border-[var(--line)] lg:border-r lg:border-b-0"
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <Sparkles
            className="size-4 text-[var(--brand-secondary)]"
            aria-hidden="true"
          />
          Ask GROS
        </h1>
        <Link
          href="/gros/new"
          aria-label="New private chat"
          title="New private chat"
          className="grid size-8 place-items-center rounded-full border border-[var(--line-strong)] text-[var(--text)] hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden"
        >
          <Plus className="size-4" aria-hidden="true" />
        </Link>
      </div>
      <details className="group border-t border-[var(--line)] lg:hidden">
        <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-[var(--text-muted)]">
          Your chats ({threads.length})
        </summary>
        <div className="max-h-64 overflow-y-auto">
          <Threads threads={threads} activeId={activeId} nowMs={nowMs} />
        </div>
        {footer}
      </details>
      <div className="hidden min-h-0 flex-1 overflow-y-auto lg:block">
        <Threads threads={threads} activeId={activeId} nowMs={nowMs} />
      </div>
      <div className="hidden lg:block">{footer}</div>
    </aside>
  )
}

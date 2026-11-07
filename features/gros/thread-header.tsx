'use client'
import { Lock, RefreshCw, Trash2, Users } from 'lucide-react'
import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState
} from 'react'
import type { FormResult } from '@/components/ui/action-form'
import { AlertDialog } from '@/components/ui/alert-dialog'
import { Pill } from '@/components/ui/pill'
import { useHydrated } from '@/components/ui/use-hydrated'
import { cn } from '@/lib/utils'
import { deleteChat, refreshData, renameChat, setVisibility } from './actions'
import { visibilityText } from './model'

const textButton =
  'inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden disabled:opacity-45'

const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [k, v] of Object.entries(values)) data.set(k, v)
  return data
}

/**
 * The right pane's header (spec §8): the chat name as an inline field
 * (rename on blur or Enter, Escape puts it back), PRIVATE / SHARED, and
 * Refresh data, Make shared / Make private and Delete. Only the person who
 * started a chat may rename, share or delete it; others see the name.
 */
export function ThreadHeader({
  chat,
  title,
  visibility,
  mine
}: {
  chat: string
  title: string
  visibility: 'private' | 'shared'
  mine: boolean
}) {
  const id = useId()
  const hydrated = useHydrated()
  const [name, setName] = useState(title)
  const saved = useRef(title)
  // Escape leaves the field without saving.
  const cancelled = useRef(false)
  // A refused name goes back to the saved one.
  const [renamed, rename, renaming] = useActionState(
    async (previous: FormResult, data: FormData) => {
      const result = await renameChat(previous, data)
      if (result.error) {
        saved.current = title
        setName(title)
      }
      return result
    },
    {}
  )
  const [shared, share, sharing] = useActionState(setVisibility, {})
  const [removed, remove, removing] = useActionState(deleteChat, {})
  const [refreshed, refresh, refreshing] = useActionState(refreshData, {})
  const [last, setLast] = useState<'rename' | 'share' | 'delete' | 'refresh'>(
    'rename'
  )
  const [confirm, setConfirm] = useState<'share' | 'delete' | null>(null)
  // A rename saved here or in another window becomes the saved name.
  useEffect(() => {
    saved.current = title
  }, [title])
  const state: FormResult =
    last === 'rename'
      ? renamed
      : last === 'share'
        ? shared
        : last === 'delete'
          ? removed
          : refreshed
  const busy = renaming || sharing || removing || refreshing
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    const clean = name.trim()
    if (!clean || clean.length > 200) {
      setName(saved.current)
      if (!clean) return
    }
    if (clean === saved.current) return
    saved.current = clean
    setLast('rename')
    startTransition(() => rename(form({ chat, title: clean })))
  }
  const next = visibility === 'private' ? 'shared' : 'private'
  return (
    <header className="space-y-2 border-b border-[var(--line)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={cn('min-w-0 flex-1', mine && 'sr-only')}>
          <span
            className={cn(!mine && 'block truncate text-base font-semibold')}
          >
            {title}
          </span>
        </h2>
        {mine && (
          <>
            <label htmlFor={`${id}-name`} className="sr-only">
              Chat name
            </label>
            <input
              id={`${id}-name`}
              value={name}
              maxLength={200}
              disabled={!hydrated}
              onChange={(event) => setName(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  event.currentTarget.blur()
                }
                if (event.key === 'Escape') {
                  cancelled.current = true
                  setName(saved.current)
                  event.currentTarget.blur()
                }
              }}
              className="min-w-0 flex-1 truncate rounded-[var(--radius-control)] border border-transparent bg-transparent px-2 py-1 text-base font-semibold hover:border-[var(--line)] focus:border-[var(--focus)] focus:outline-hidden"
            />
          </>
        )}
        <Pill
          tone={visibility === 'private' ? 'neutral' : 'info'}
          title={visibilityText(visibility, mine)}
        >
          {visibility === 'private' ? (
            <Lock className="mr-1 inline size-3" aria-hidden="true" />
          ) : (
            <Users className="mr-1 inline size-3" aria-hidden="true" />
          )}
          {visibility === 'private' ? 'PRIVATE' : 'SHARED'}
        </Pill>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            className={textButton}
            disabled={!hydrated || busy}
            title="Re-read your latest Klaviyo + Shopify data. They are sample connections for now, so nothing new comes in."
            onClick={() => {
              setLast('refresh')
              startTransition(() => refresh(form({ chat })))
            }}
          >
            <RefreshCw
              className={cn(
                'size-4',
                refreshing && 'animate-spin motion-reduce:animate-none'
              )}
              aria-hidden="true"
            />
            Refresh data
          </button>
          {mine && (
            <>
              <button
                type="button"
                className={textButton}
                disabled={!hydrated || busy}
                onClick={() => setConfirm('share')}
              >
                {next === 'shared' ? (
                  <Users className="size-4" aria-hidden="true" />
                ) : (
                  <Lock className="size-4" aria-hidden="true" />
                )}
                {next === 'shared' ? 'Make shared' : 'Make private'}
              </button>
              <button
                type="button"
                className={cn(
                  textButton,
                  'text-[var(--danger-ink)] hover:text-[var(--danger-ink)]'
                )}
                disabled={!hydrated || busy}
                onClick={() => setConfirm('delete')}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Delete
              </button>
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        {visibilityText(visibility, mine)}
      </p>
      <p
        aria-live="polite"
        className={cn(
          'text-sm',
          !(state.error || state.message)
            ? 'sr-only'
            : state.error
              ? 'rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-[var(--danger-ink)]'
              : 'rounded-lg bg-[var(--brand-soft)] px-3 py-2 text-[var(--brand-ink)]'
        )}
      >
        {busy ? '' : (state.error ?? state.message ?? '')}
      </p>
      <AlertDialog
        open={confirm === 'share'}
        tone="primary"
        title={
          next === 'shared'
            ? 'Share this chat with your team?'
            : 'Make this chat private?'
        }
        confirmLabel={next === 'shared' ? 'Make shared' : 'Make private'}
        pending={sharing}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setLast('share')
          startTransition(() => {
            share(form({ chat, visibility: next }))
            setConfirm(null)
          })
        }}
      >
        <p>
          {next === 'shared'
            ? 'Everyone in your workspace team will be able to read every message in it, including earlier ones. Only you can rename, delete or make it private again.'
            : 'Only you will be able to see it. Your team loses access right away.'}
        </p>
      </AlertDialog>
      <AlertDialog
        open={confirm === 'delete'}
        title="Delete this chat?"
        confirmLabel="Delete chat"
        pending={removing}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setLast('delete')
          startTransition(() => {
            remove(form({ chat }))
            setConfirm(null)
          })
        }}
      >
        <p>
          Its messages and any changes still waiting for your decision are
          deleted. Changes you already applied stay on the campaign. This can’t
          be undone.
        </p>
      </AlertDialog>
    </header>
  )
}

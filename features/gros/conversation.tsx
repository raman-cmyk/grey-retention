'use client'
import Link from 'next/link'
import type { Route } from 'next'
import { ArrowUp } from 'lucide-react'
import {
  useActionState,
  useEffect,
  useId,
  useOptimistic,
  useRef,
  useState
} from 'react'
import type { FormResult } from '@/components/ui/action-form'
import { TypingIndicator } from '@/components/ui/chat'
import { useHydrated } from '@/components/ui/use-hydrated'
import { cn } from '@/lib/utils'
import { sendMessage, startChat } from './actions'
import type { GrosMessage } from './data'
import { Markdown } from './markdown'
import { isSendKey, starterQuestions } from './model'

function Bubble({
  role,
  children
}: {
  role: 'user' | 'assistant'
  children: React.ReactNode
}) {
  return role === 'assistant' ? (
    <li className="flex">
      <div className="max-w-[75%] rounded-[1.125rem] rounded-bl-md border border-[var(--line)] bg-[var(--surface-raised)] px-4 py-3 text-sm leading-6 text-[var(--text)]">
        <span className="sr-only">GROS: </span>
        {children}
      </div>
    </li>
  ) : (
    <li className="flex justify-end">
      <div className="max-w-[75%] rounded-[1.125rem] rounded-br-md bg-[var(--text)] px-4 py-2.5 text-sm leading-6 break-words whitespace-pre-wrap text-[var(--surface-raised)]">
        <span className="sr-only">You: </span>
        {children}
      </div>
    </li>
  )
}

/**
 * The messages and the composer (spec §8). GROS's greeting comes first;
 * replies render a safe Markdown subset; while an answer is coming the
 * question shows at once with a typing indicator. ⌘/Ctrl+Enter sends and
 * Enter adds a line. The text is kept when sending fails.
 */
export function Conversation({
  chat,
  greeting,
  assistant = 'GROS',
  messages,
  earlierBefore,
  paged,
  campaigns,
  children
}: {
  /** Null on the new-chat screen: the first question creates the chat. */
  chat: string | null
  greeting: string
  /** The assistant's name (white-label), e.g. "GROS". */
  assistant?: string
  messages: GrosMessage[]
  earlierBefore: number | null
  paged: boolean
  campaigns: { id: string; title: string }[]
  /** Shown under the messages (proposed changes). */
  children?: React.ReactNode
}) {
  const id = useId()
  const hydrated = useHydrated()
  const [text, setText] = useState('')
  const [campaign, setCampaign] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const [shown, addPending] = useOptimistic(
    messages,
    (list, question: string) => [
      ...list,
      {
        id: `pending-${list.length}`,
        role: 'user' as const,
        body: question,
        index: Number.MAX_SAFE_INTEGER,
        at: ''
      }
    ]
  )
  const [state, send, sending] = useActionState(
    async (previous: FormResult, data: FormData) => {
      const question = String(data.get('question') ?? '')
      addPending(question)
      const result = await (chat ? sendMessage : startChat)(previous, data)
      // Clear only what was sent; keep anything typed while waiting.
      if (!result.error)
        setText((current) => (current === question ? '' : current))
      return result
    },
    {}
  )
  // Keep the newest message in view when one arrives (not when paging back).
  useEffect(() => {
    if (!paged) end.current?.scrollIntoView?.({ block: 'end' })
  }, [shown.length, sending, paged])
  useEffect(() => {
    if (state.error) box.current?.focus()
  }, [state])
  // In a chat, questions queue while GROS answers (they are sent in order).
  // A new chat waits for its first answer, which creates it.
  const ready =
    hydrated && (chat !== null || !sending) && text.trim().length > 0
  const lastAnswer = [...messages].reverse().find((m) => m.role === 'assistant')
  const empty = messages.length === 0
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="region"
        aria-label="Conversation"
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4 focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden focus-visible:ring-inset"
      >
        {earlierBefore !== null && (
          <p className="mb-3 text-center">
            <Link
              href={`/gros/${chat}?before=${earlierBefore}` as Route}
              className="text-sm font-medium text-[var(--brand-secondary)] underline-offset-2 hover:underline"
            >
              Earlier messages
            </Link>
          </p>
        )}
        <ol aria-label="Messages" className="flex flex-col gap-3">
          {earlierBefore === null && (
            <Bubble role="assistant">
              <Markdown text={greeting} />
            </Bubble>
          )}
          {shown.map((m) => (
            <Bubble key={m.id} role={m.role}>
              {m.role === 'assistant' ? (
                <Markdown text={m.body} />
              ) : (
                <span>{m.body}</span>
              )}
            </Bubble>
          ))}
          {sending && (
            <li className="flex" role="status">
              <TypingIndicator assistantName={assistant} />
            </li>
          )}
        </ol>
        <div ref={end} />
        {/* Read out each new answer; the first line is enough. */}
        <p className="sr-only" aria-live="polite">
          {lastAnswer
            ? `${assistant} answered: ${lastAnswer.body.split('\n')[0]}`
            : ''}
        </p>
        {paged && (
          <p className="mt-3 text-center">
            <Link
              href={`/gros/${chat}` as Route}
              className="text-sm font-medium text-[var(--brand-secondary)] underline-offset-2 hover:underline"
            >
              Latest messages
            </Link>
          </p>
        )}
        {empty && !sending && (
          <div
            className="mt-4 flex flex-wrap gap-2"
            aria-label="Suggested questions"
            role="group"
          >
            {starterQuestions.map((q) => (
              <button
                key={q}
                type="button"
                disabled={!hydrated}
                onClick={() => {
                  setText(q)
                  box.current?.focus()
                }}
                className="rounded-full border border-[var(--line-strong)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden disabled:opacity-45"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        {children}
      </div>
      {paged ? (
        <p className="border-t border-[var(--line)] px-4 py-3 text-sm text-[var(--text-muted)]">
          You are reading older messages.{' '}
          <Link
            href={`/gros/${chat}` as Route}
            className="font-medium text-[var(--brand-secondary)] underline-offset-2 hover:underline"
          >
            Go to the latest messages
          </Link>{' '}
          to reply.
        </p>
      ) : (
        <form
          action={send}
          className="space-y-2 border-t border-[var(--line)] px-4 py-3"
        >
          {chat && <input type="hidden" name="chat" value={chat} />}
          <input type="hidden" name="campaign" value={campaign} />
          {state.error && (
            <p
              role="alert"
              className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger-ink)]"
            >
              {state.error}
            </p>
          )}
          <div className="flex items-end gap-2">
            <label htmlFor={`${id}-question`} className="sr-only">
              Message {assistant}
            </label>
            <textarea
              ref={box}
              id={`${id}-question`}
              name="question"
              rows={2}
              maxLength={5000}
              value={text}
              placeholder={`Ask ${assistant} anything in this thread…`}
              aria-invalid={Boolean(state.error)}
              aria-describedby={`${id}-hint`}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (
                  isSendKey({
                    key: event.key,
                    metaKey: event.metaKey,
                    ctrlKey: event.ctrlKey,
                    isComposing: event.nativeEvent.isComposing,
                    keyCode: event.keyCode
                  })
                ) {
                  event.preventDefault()
                  if (ready) event.currentTarget.form?.requestSubmit()
                }
              }}
              className="field-sizing-content max-h-48 min-h-14 flex-1 resize-none rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm leading-6 text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--brand-secondary)] focus:ring-2 focus:ring-[var(--brand-secondary)] focus:outline-hidden"
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={!ready}
              className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-control)] bg-[var(--brand-primary)] text-[var(--on-brand)] hover:bg-[var(--brand-primary-strong)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:opacity-35"
            >
              <ArrowUp className="size-5" aria-hidden="true" />
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p id={`${id}-hint`} className="text-xs text-[var(--text-muted)]">
              ⌘/Ctrl + Enter to send. Each answer uses AI credits (sample
              credits for now).
            </p>
            {campaigns.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <label htmlFor={`${id}-about`}>About</label>
                <select
                  id={`${id}-about`}
                  value={campaign}
                  onChange={(event) => setCampaign(event.target.value)}
                  className={cn(
                    'max-w-[14rem] truncate rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-[var(--surface-raised)] px-2 py-1 text-xs text-[var(--text)]'
                  )}
                >
                  <option value="">Your whole workspace</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </form>
      )}
    </div>
  )
}

'use client'

import { ArrowUp, Plus } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { cn } from '@/lib/utils'

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
}

/**
 * Chat thread (docs/UI_REBUILD_SPEC.md §2 "Chat UI"): the owner's bubbles on
 * the right, the assistant's on the left, an optional tiny caption under each
 * (YOU / GROS), a typing indicator, and auto-scroll to the newest message.
 * Text is always rendered as plain text, never as HTML.
 */
export function ChatThread({
  messages,
  assistantName,
  typing = false,
  captions = true,
  label,
  className
}: {
  messages: readonly ChatMessage[]
  assistantName: string
  typing?: boolean
  captions?: boolean
  /** Accessible name of the conversation log. */
  label: string
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const last = messages.at(-1)?.id
  useEffect(() => {
    const element = box.current
    // Follow new messages unless the owner scrolled up to read.
    if (element && pinned.current) element.scrollTop = element.scrollHeight
  }, [last, typing])
  return (
    <div
      ref={box}
      role="log"
      aria-label={label}
      aria-live="polite"
      onScroll={(event) => {
        const element = event.currentTarget
        pinned.current =
          element.scrollHeight - element.scrollTop - element.clientHeight < 48
      }}
      className={cn('flex flex-col gap-4 overflow-y-auto p-1', className)}
    >
      {messages.map((message) => {
        const mine = message.role === 'user'
        return (
          <div
            key={message.id}
            className={cn(
              'flex max-w-[85%] flex-col',
              mine ? 'items-end self-end' : 'items-start self-start'
            )}
          >
            <p
              className={cn(
                'rounded-[1.125rem] px-4 py-2.5 text-sm leading-6 break-words whitespace-pre-wrap',
                mine
                  ? 'rounded-br-md bg-[var(--brand-primary)] text-[var(--on-brand)]'
                  : 'rounded-bl-md border border-[var(--line)] bg-[var(--surface-raised)] text-[var(--text)]'
              )}
            >
              <span className="sr-only">
                {mine ? 'You said: ' : `${assistantName} said: `}
              </span>
              {message.text}
            </p>
            {captions && (
              <span
                aria-hidden
                className="tracking-label mt-1 px-1 font-mono text-[0.625rem] text-[var(--text-muted)] uppercase"
              >
                {mine ? 'You' : assistantName}
              </span>
            )}
          </div>
        )
      })}
      {typing && <TypingIndicator assistantName={assistantName} />}
    </div>
  )
}

/** Three dots that bounce while the assistant writes; still under reduced motion. */
export function TypingIndicator({ assistantName }: { assistantName: string }) {
  return (
    <div className="flex items-center gap-1 self-start rounded-[1.125rem] rounded-bl-md border border-[var(--line)] bg-[var(--surface-raised)] px-4 py-3.5">
      <span className="sr-only">{assistantName} is typing</span>
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          aria-hidden
          className="size-1.5 animate-bounce rounded-full bg-[var(--text-muted)] motion-reduce:animate-none"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  )
}

/** Suggested answers the owner can tap instead of typing. */
export function QuickReplies({
  replies,
  disabled = false,
  onPick
}: {
  replies: readonly string[]
  disabled?: boolean
  onPick: (reply: string) => void
}) {
  if (!replies.length) return null
  return (
    <div
      role="group"
      aria-label="Suggested replies"
      className="flex flex-wrap gap-2"
    >
      {replies.map((reply, index) => (
        <button
          key={`${index}-${reply}`}
          type="button"
          disabled={disabled}
          onClick={() => onPick(reply)}
          className="min-h-9 rounded-full border border-[var(--line-strong)] bg-[var(--surface-raised)] px-3.5 text-sm hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden disabled:opacity-45"
        >
          {reply}
        </button>
      ))}
    </div>
  )
}

/**
 * Composer: optional `+` attach button, the message box, and a round send
 * button. Enter sends, Shift+Enter adds a line, and Enter that finishes an
 * IME word (Japanese, Chinese…) never sends. Empty messages are never sent,
 * nothing is sent twice, and the text is kept if sending fails (`onSend`
 * returns or resolves to `false`).
 */
export function ChatComposer({
  label,
  placeholder = 'Type a message…',
  disabled = false,
  maxLength = 4000,
  onSend,
  onAttach
}: {
  label: string
  placeholder?: string
  disabled?: boolean
  maxLength?: number
  onSend: (text: string) => boolean | void | Promise<boolean | void>
  onAttach?: () => void
}) {
  const id = useId()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const busy = useRef(false)
  const ready = text.trim().length > 0 && !disabled && !sending
  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!ready || busy.current) return
    busy.current = true
    setSending(true)
    const sent = text.trim()
    try {
      const ok = await onSend(sent)
      if (ok !== false)
        setText((current) => (current.trim() === sent ? '' : current))
    } catch {
      // Sending failed: keep the text so the owner can try again.
    } finally {
      busy.current = false
      setSending(false)
    }
  }
  return (
    <form
      onSubmit={submit}
      className="flex items-end gap-2 rounded-[1.375rem] border border-[var(--line-strong)] bg-[var(--surface-raised)] p-1.5 focus-within:border-[var(--focus)] focus-within:ring-1 focus-within:ring-[var(--focus)]"
    >
      {onAttach && (
        <button
          type="button"
          aria-label="Attach a file"
          disabled={disabled}
          onClick={onAttach}
          className="grid size-9 shrink-0 place-items-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden disabled:opacity-45"
        >
          <Plus className="size-5" aria-hidden />
        </button>
      )}
      <label htmlFor={`${id}-input`} className="sr-only">
        {label}
      </label>
      <textarea
        id={`${id}-input`}
        rows={1}
        value={text}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            // Safari ends composition before this keydown (keyCode 229).
            !event.nativeEvent.isComposing &&
            event.keyCode !== 229
          ) {
            event.preventDefault()
            submit()
          }
        }}
        className="field-sizing-content max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-6 text-[var(--text)] outline-hidden placeholder:text-[var(--text-faint)]"
      />
      <button
        type="submit"
        aria-label="Send message"
        disabled={!ready}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--brand-primary)] text-[var(--on-brand)] hover:bg-[var(--brand-primary-strong)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:opacity-35"
      >
        <ArrowUp className="size-4" aria-hidden />
      </button>
    </form>
  )
}

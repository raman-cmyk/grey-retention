'use client'

import {
  createContext,
  use,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { useFormStatus } from 'react-dom'
import { useHydrated } from '@/components/ui/use-hydrated'
import { cn } from '@/lib/utils'
import { buttonClasses, type ButtonKind, type ButtonSize } from './button'

/**
 * A GROS button that runs a server action (Plan next 15 days, Create email).
 * It keeps its words while working (BRAND.md: the page shows the progress),
 * cannot be pressed twice or before the page's JavaScript runs (a native
 * post would lose the action's answer), and says under itself what went
 * wrong (or what was done), in the action's own plain words. With
 * `children` (GROS `Field`s) it is a small form: the fields sit above it.
 * Inside `ActionAnswers` the answer shows in the card's one place instead,
 * so it stays when the button goes with the change it made (Remove).
 */
export type ActionResult = { error?: string; message?: string }
export type ServerAction = (
  state: ActionResult,
  form: FormData
) => Promise<ActionResult>

type Answer = ActionResult & { from?: string }
const Answers = createContext<{
  id: string
  answer: Answer
  say: (answer: Answer) => void
} | null>(null)

const words = (a: ActionResult | null) => a?.error ?? a?.message ?? null

function AnswerLine({
  id,
  answer
}: {
  id: string
  answer: ActionResult | null
}) {
  return (
    <p
      id={id}
      aria-live="polite"
      className={cn(
        'type-caption empty:hidden',
        answer?.error ? 'text-[var(--signal-ink)]' : 'text-[var(--ink)]'
      )}
    >
      {words(answer) ?? ''}
    </p>
  )
}

/** One place for the answers of a card's buttons, after its content. */
export function ActionAnswers({ children }: { children: ReactNode }) {
  const id = useId()
  const [answer, say] = useState<Answer>({})
  return (
    <Answers value={{ id, answer, say }}>
      {children}
      <AnswerLine id={id} answer={answer} />
    </Answers>
  )
}

export function ActionButton({
  action,
  label,
  kind = 'main',
  size = 'app',
  fields = {},
  spokenLabel,
  children,
  clear = 'success',
  confirm
}: {
  action: ServerAction
  /** The button's words, kept while the action runs. */
  label: string
  kind?: Exclude<ButtonKind, 'round'>
  size?: ButtonSize
  /** Hidden values the action reads (a run and a slot). */
  fields?: Record<string, string>
  /**
   * What a screen reader says when many buttons share a label: Pin: Lead
   * with one product. It always starts with the visible label.
   */
  spokenLabel?: string
  /** Fields the person fills in, above the button. */
  children?: ReactNode
  /**
   * When the typed fields clear: after a success (a refusal keeps them to
   * fix), or `always` (a key, which must not stay on the page).
   */
  clear?: 'success' | 'always'
  /** Asked first (Disconnect): No stops the action. */
  confirm?: string
}) {
  const area = use(Answers)
  const me = useId()
  const refused = useRef(false)
  const [state, dispatch, pending] = useActionState(
    async (previous: ActionResult, form: FormData) => {
      const result = await action(previous, form)
      refused.current = !!result.error
      area?.say({ ...result, from: me })
      return result
    },
    {}
  )
  // A new try hides the last answer until its own arrives.
  const say = area?.say
  useEffect(() => {
    if (pending) say?.({})
  }, [pending, say])
  const own = useId()
  const answer = pending ? null : area ? null : state
  const describedBy = area
    ? area.answer.from === me && words(area.answer)
      ? area.id
      : undefined
    : words(answer)
      ? own
      : undefined
  return (
    <form
      action={dispatch}
      aria-busy={pending}
      onReset={(event) => {
        if (clear === 'success' && refused.current) event.preventDefault()
      }}
      onSubmit={
        confirm
          ? (event) => {
              if (!window.confirm(confirm)) event.preventDefault()
            }
          : undefined
      }
      className={cn(
        'flex flex-col items-start',
        children ? 'gap-[var(--space-4)]' : 'gap-[var(--space-2)]'
      )}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children ? (
        <div className="flex w-full flex-col gap-[var(--space-4)]">
          {children}
        </div>
      ) : null}
      <Submit
        label={label}
        spoken={
          spokenLabel === undefined || spokenLabel.startsWith(label)
            ? spokenLabel
            : `${label}: ${spokenLabel}`
        }
        kind={kind}
        size={size}
        describedBy={describedBy}
      />
      {area ? null : <AnswerLine id={own} answer={answer} />}
    </form>
  )
}

function Submit({
  label,
  spoken,
  kind,
  size,
  describedBy
}: {
  label: string
  spoken?: string
  kind: Exclude<ButtonKind, 'round'>
  size: ButtonSize
  describedBy?: string
}) {
  const { pending } = useFormStatus()
  const hydrated = useHydrated()
  return (
    <button
      type="submit"
      disabled={pending || !hydrated}
      aria-label={spoken}
      aria-describedby={describedBy}
      className={buttonClasses(kind, size)}
    >
      {label}
    </button>
  )
}

'use client'
import {
  useActionState,
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject
} from 'react'
import Link from 'next/link'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { changePassword, updateAccount, type ProfileResult } from './actions'
import { PASSWORD_MIN } from './rules'

/** After a refused save, move focus to the first field with an error. */
function useFocusFirstError(
  state: ProfileResult,
  form: RefObject<HTMLFormElement | null>
) {
  useEffect(() => {
    if (!state.fieldErrors) return
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [state, form])
}

const labelClass =
  'tracking-label block font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase'

function Card({
  title,
  description,
  children
}: {
  title: string
  description: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <section
      aria-labelledby={id}
      className="space-y-5 rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-6"
    >
      <div>
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        <p className="text-sm text-[var(--text-muted)]">{description}</p>
      </div>
      {children}
    </section>
  )
}

/** Label, input, help or error; the error is linked to the input. */
function Input({
  name,
  label,
  error,
  help,
  ...props
}: {
  name: string
  label: ReactNode
  error?: string
  help?: ReactNode
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <div className="space-y-2">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <TextField
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || help ? `${id}-note` : undefined}
        {...props}
      />
      {(error || help) && (
        <p
          id={`${id}-note`}
          className={`text-xs ${error ? 'text-[var(--danger-ink)]' : 'text-[var(--text-muted)]'}`}
        >
          {error ?? help}
        </p>
      )}
    </div>
  )
}

function Status({ state }: { state: ProfileResult }) {
  return (
    <p
      aria-live="polite"
      className={`text-sm empty:hidden ${state.status === 'error' ? 'text-[var(--danger-ink)]' : 'text-[var(--text-muted)]'}`}
    >
      {state.message}
    </p>
  )
}

export function AccountForm({
  name,
  email,
  jobTitle,
  phone
}: {
  name: string
  email: string
  jobTitle: string
  phone: string
}) {
  const [state, action, pending] = useActionState(updateAccount, {})
  const errors = state.fieldErrors ?? {}
  const formRef = useRef<HTMLFormElement>(null)
  useFocusFirstError(state, formRef)
  return (
    <Card
      title="Account information"
      description="Name, job title, and contact phone."
    >
      {/* Keep what the owner typed after an error (React resets forms after an action). */}
      <form
        ref={formRef}
        action={action}
        className="space-y-5"
        aria-busy={pending}
        onReset={(event) => event.preventDefault()}
      >
        <Input
          name="name"
          label="Name"
          defaultValue={name}
          autoComplete="name"
          required
          minLength={2}
          maxLength={120}
          error={errors.name}
        />
        <Input
          name="email"
          label={
            <span className="inline-flex items-center gap-1.5">
              Email <Lock className="size-3" aria-hidden="true" />
            </span>
          }
          value={email}
          disabled
          readOnly
          help={
            <>
              Email is locked. Contact{' '}
              <Link href="/support" className="underline">
                support
              </Link>{' '}
              if you need to change it.
            </>
          }
        />
        <Input
          name="jobTitle"
          label="Job title"
          defaultValue={jobTitle}
          autoComplete="organization-title"
          maxLength={120}
          error={errors.jobTitle}
        />
        <Input
          name="phone"
          label="Phone"
          type="tel"
          defaultValue={phone}
          autoComplete="tel"
          maxLength={40}
          error={errors.phone}
        />
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save changes'}
          </Button>
          <Status state={state} />
        </div>
      </form>
    </Card>
  )
}

export function PasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(changePassword, {})
  const errors = state.fieldErrors ?? {}
  const formRef = useRef<HTMLFormElement>(null)
  useFocusFirstError(state, formRef)
  return (
    <Card
      title="Change password"
      description={`At least ${PASSWORD_MIN} characters. We'll verify your current password first.`}
    >
      {/* Password fields are cleared after every attempt (React's default). */}
      <form
        ref={formRef}
        action={action}
        className="space-y-5"
        aria-busy={pending}
      >
        {/* Lets password managers save the new password for this account. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={email}
          readOnly
          hidden
        />
        <Input
          name="current"
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
          error={errors.current}
        />
        <Input
          name="next"
          label="New password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          required
          error={errors.next}
        />
        <Input
          name="confirm"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          required
          error={errors.confirm}
        />
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={pending}>
            {pending ? 'Checking…' : 'Update password'}
          </Button>
          <Status state={state} />
        </div>
      </form>
    </Card>
  )
}

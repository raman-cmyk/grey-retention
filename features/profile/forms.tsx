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
import { Button } from '@/components/gros/button'
import { Card } from '@/components/gros/card'
import { Field } from '@/components/gros/input'
import { cn } from '@/lib/utils'
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

/** A white GROS card with its one heading (BRAND.md: no subtitle). */
function FormCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card size="small" label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">{title}</h2>
        {children}
      </div>
    </Card>
  )
}

/** The form's answer beside its button: signal ink when refused. */
function Status({ state }: { state: ProfileResult }) {
  return (
    <p
      aria-live="polite"
      className={cn(
        'type-caption empty:hidden',
        state.status === 'error'
          ? 'text-[var(--signal-ink)]'
          : 'text-[var(--ink)]'
      )}
    >
      {state.message}
    </p>
  )
}

const formClass = 'flex flex-col items-start gap-[var(--space-5)]'
const fieldsClass = 'flex w-full flex-col gap-[var(--space-4)]'

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
  const lockedId = useId()
  useFocusFirstError(state, formRef)
  return (
    <FormCard title="Account information">
      {/* Keep what the owner typed after an error (React resets forms after an action). */}
      <form
        ref={formRef}
        action={action}
        className={formClass}
        aria-busy={pending}
        onReset={(event) => event.preventDefault()}
      >
        <div className={fieldsClass}>
          <Field
            name="name"
            label="Name"
            defaultValue={name}
            autoComplete="name"
            required
            minLength={2}
            maxLength={120}
            error={errors.name}
          />
          <div className="flex flex-col gap-[var(--space-2)]">
            <Field
              name="email"
              label="Email"
              value={email}
              disabled
              readOnly
              aria-describedby={lockedId}
            />
            <p id={lockedId} className="type-caption text-[var(--stone)]">
              Email is locked. Contact{' '}
              <Link href="/settings#support" className="underline">
                support
              </Link>{' '}
              if you need to change it.
            </p>
          </div>
          <Field
            name="jobTitle"
            label="Job title"
            defaultValue={jobTitle}
            autoComplete="organization-title"
            maxLength={120}
            error={errors.jobTitle}
          />
          <Field
            name="phone"
            label="Phone"
            type="tel"
            defaultValue={phone}
            autoComplete="tel"
            maxLength={40}
            error={errors.phone}
          />
        </div>
        <Button type="submit" label="Save changes" disabled={pending} />
        <Status state={state} />
      </form>
    </FormCard>
  )
}

export function PasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(changePassword, {})
  const errors = state.fieldErrors ?? {}
  const formRef = useRef<HTMLFormElement>(null)
  useFocusFirstError(state, formRef)
  return (
    <FormCard title="Change password">
      {/* Password fields are cleared after every attempt (React's default). */}
      <form
        ref={formRef}
        action={action}
        className={formClass}
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
        <div className={fieldsClass}>
          <Field
            name="current"
            label="Current password"
            type="password"
            autoComplete="current-password"
            required
            error={errors.current}
          />
          <Field
            name="next"
            label="New password"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN}
            required
            error={errors.next}
          />
          <Field
            name="confirm"
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            required
            error={errors.confirm}
          />
        </div>
        <Button type="submit" label="Update password" disabled={pending} />
        <Status state={state} />
      </form>
    </FormCard>
  )
}

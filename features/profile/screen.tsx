import { ButtonLink } from '@/components/gros/button'
import { AppPage, CardRow, defaultAssistant } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'
import { AccountForm, PasswordForm } from './forms'

export type AccountView = {
  name: string
  email: string
  jobTitle: string
  phone: string
}

/**
 * Account (UI-AUTH), a GROS page under Settings: replaces the old /profile
 * page. The person's own name, job title and phone (the email is locked),
 * and a password change that checks the current password first. When the
 * profile cannot be read, the page says to sign in again.
 */
export function AccountScreen({
  profile,
  assistant = defaultAssistant
}: {
  profile: AccountView | null
  assistant?: string
}) {
  return (
    <AppPage current="settings" title="Account" assistant={assistant}>
      <div>
        <ButtonLink href="/settings" label="Back to Settings" kind="quiet" />
      </div>
      {!profile ? (
        <ErrorState
          title="Account did not open"
          reason="We could not read your account. Sign in again to see it."
          action={<ButtonLink href="/login" label="Sign in again" />}
        />
      ) : (
        <CardRow>
          <AccountForm {...profile} />
          <PasswordForm email={profile.email} />
        </CardRow>
      )}
    </AppPage>
  )
}

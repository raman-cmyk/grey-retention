import type { Metadata } from 'next'
import { PageHeading, Notice } from '@/components/ui/workspace'
import { profilePageData } from '@/features/profile/data'
import { AccountForm, PasswordForm } from '@/features/profile/forms'

export const metadata: Metadata = { title: 'Profile' }

export default async function ProfilePage() {
  const profile = await profilePageData()
  return (
    <div className="mx-auto max-w-[670px]">
      <PageHeading
        title="Profile"
        description="Update your account information and password."
      />
      {!profile ? (
        <Notice error>Please sign in again to see your profile.</Notice>
      ) : (
        <div className="space-y-6">
          <AccountForm {...profile} />
          <PasswordForm email={profile.email} />
        </div>
      )}
    </div>
  )
}

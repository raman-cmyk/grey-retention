import type { Metadata } from 'next'
import { PageHeading, Notice } from '@/components/ui/workspace'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { AccountForm, PasswordForm } from '@/features/profile/forms'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Profile' }

export default async function ProfilePage() {
  const context = await requireRequestContext('client')
  const db = await createClient()
  const user = db ? await db.auth.getUser() : null
  const profile = db
    ? await db
        .from('profiles')
        .select('full_name,job_title,phone')
        .eq('id', context.userId)
        .maybeSingle()
    : null
  return (
    <div className="mx-auto max-w-[670px]">
      <PageHeading
        title="Profile"
        description="Update your account information and password."
      />
      {!profile?.data || !user?.data.user ? (
        <Notice error>Please sign in again to see your profile.</Notice>
      ) : (
        <div className="space-y-6">
          <AccountForm
            name={profile.data.full_name}
            email={user.data.user.email ?? ''}
            jobTitle={profile.data.job_title ?? ''}
            phone={profile.data.phone ?? ''}
          />
          <PasswordForm />
        </div>
      )}
    </div>
  )
}

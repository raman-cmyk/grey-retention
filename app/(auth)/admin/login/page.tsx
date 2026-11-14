import { SignInPanel } from '@/components/auth/sign-in-panel'
import { safeNext } from '@/features/auth/domain/next'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Admin sign in' }

export default async function AdminLoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string | string[] }>
}) {
  const { next } = await searchParams
  return (
    <SignInPanel
      title="Platform control."
      description="Restricted access for tenant operations, model governance, jobs, and support."
      surface="admin"
      next={safeNext('admin', next)}
      resetHref="/forgot-password"
    />
  )
}

import { SignInPanel } from '@/components/auth/sign-in-panel'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Admin sign in' }

export default function AdminLoginPage() {
  return (
    <SignInPanel
      title="Platform control."
      description="Restricted access for tenant operations, model governance, jobs, and support."
      surface="admin"
      resetHref="/forgot-password"
    />
  )
}

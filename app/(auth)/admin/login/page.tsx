import { SignInPanel } from '@/components/auth/sign-in-panel'

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

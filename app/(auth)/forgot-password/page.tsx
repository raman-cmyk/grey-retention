import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'

export default function ForgotPasswordPage() {
  return (
    <div>
      <h1 className="font-[family-name:var(--font-display)] text-4xl leading-none font-bold tracking-[-0.035em]">
        Reset access.
      </h1>
      <p className="mt-4 text-sm leading-6 text-white/62">
        Enter account email. Reset link delivery arrives in IAM-001.
      </p>
      <form className="mt-9 space-y-5">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white/78">
            Email
          </span>
          <TextField name="email" type="email" autoComplete="email" required />
        </label>
        <Button className="w-full" type="submit">
          Request reset link
        </Button>
      </form>
      <Link
        className="mt-5 inline-block text-sm text-white/65 underline hover:text-white"
        href="/login"
      >
        Back to sign in
      </Link>
    </div>
  )
}

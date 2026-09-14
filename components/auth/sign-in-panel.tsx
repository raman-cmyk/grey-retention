import Link from 'next/link'
import type { Route } from 'next'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'

export function SignInPanel({
  title,
  description,
  resetHref = '/forgot-password'
}: {
  title: string
  description: string
  resetHref?: Route
}) {
  return (
    <div>
      <h1 className="font-[family-name:var(--font-display)] text-4xl leading-none font-bold tracking-[-0.035em]">
        {title}
      </h1>
      <p className="mt-4 max-w-sm text-sm leading-6 text-white/62">
        {description}
      </p>
      <form className="mt-9 space-y-5">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white/78">
            Email
          </span>
          <TextField
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@company.com"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white/78">
            Password
          </span>
          <TextField
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="Enter password"
          />
        </label>
        <Button className="w-full" type="submit">
          Sign in
        </Button>
      </form>
      <Link
        className="mt-5 inline-block text-sm text-white/65 underline hover:text-white"
        href={resetHref}
      >
        Forgot password?
      </Link>
    </div>
  )
}

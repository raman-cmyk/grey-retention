import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'

export default function SignupPage() {
  return (
    <div>
      <h1 className="font-[family-name:var(--font-display)] text-4xl leading-none font-bold tracking-[-0.035em]">
        Create workspace.
      </h1>
      <p className="mt-4 text-sm leading-6 text-white/62">
        Account and tenant provisioning arrives in IAM-001.
      </p>
      <form className="mt-9 grid gap-5 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-2 block text-sm font-medium text-white/78">
            Name
          </span>
          <TextField name="name" autoComplete="name" required />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-2 block text-sm font-medium text-white/78">
            Work email
          </span>
          <TextField name="email" type="email" autoComplete="email" required />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-2 block text-sm font-medium text-white/78">
            Password
          </span>
          <TextField
            name="password"
            type="password"
            autoComplete="new-password"
            required
          />
        </label>
        <Button className="sm:col-span-2" type="submit">
          Continue
        </Button>
      </form>
    </div>
  )
}

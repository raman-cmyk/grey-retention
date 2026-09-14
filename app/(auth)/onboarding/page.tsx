import { WorkspaceForm } from '@/components/auth/workspace-form'

export default function OnboardingPage() {
  return (
    <div>
      <p className="font-[family-name:var(--font-data)] text-[0.65rem] tracking-[0.08em] text-[var(--text-faint)] uppercase">
        Account confirmed / step 2 of 2
      </p>
      <h1 className="mt-4 font-[family-name:var(--font-display)] text-4xl leading-none font-bold tracking-[-0.035em]">
        Name the workspace.
      </h1>
      <p className="mt-4 text-sm leading-6 text-[var(--text-muted)]">
        This creates the tenant boundary and makes you its first owner.
      </p>
      <WorkspaceForm />
    </div>
  )
}

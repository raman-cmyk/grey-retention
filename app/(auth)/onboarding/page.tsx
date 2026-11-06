import { InvitationPanel } from '@/features/operations/panels'
import { WorkspaceForm } from '@/components/auth/workspace-form'

export default function OnboardingPage() {
  return (
    <div>
      <p className="font-[family-name:var(--font-data)] text-[0.65rem] tracking-[0.08em] text-[var(--text-faint)] uppercase">
        Let’s get you started
      </p>
      <h1 className="tracking-display mt-4 font-[family-name:var(--font-display)] text-4xl leading-none font-normal">
        Start with your brand.
      </h1>
      <p className="mt-4 text-sm leading-6 text-[var(--text-muted)]">
        One brand per workspace. You can add your store details next.
      </p>
      <InvitationPanel />
      <WorkspaceForm />
    </div>
  )
}

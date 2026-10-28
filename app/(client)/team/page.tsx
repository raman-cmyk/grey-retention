import { PageHeading } from '@/components/ui/workspace'
import { TeamPanel } from '@/features/operations/panels'
export default function Page() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeading
        title="Team"
        description="Workspace membership and invitation history. External email delivery is simulated."
      />
      <TeamPanel />
    </div>
  )
}

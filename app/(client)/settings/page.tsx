import { PageHeading } from '@/components/ui/workspace'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { PolicyPanel } from '@/features/delivery/panels'
export default async function SettingsPage() {
  const ctx = await requireRequestContext('client')
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeading
        title="Workspace settings"
        description={`Timezone: ${ctx.timezone}. Owner-confirmed defaults and delivery automation use synthetic providers.`}
      />
      <PolicyPanel tenantId={ctx.tenantId} owner={ctx.tenantRole === 'owner'} />
    </div>
  )
}

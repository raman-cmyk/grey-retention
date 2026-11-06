import { PageHeading } from '@/components/ui/workspace'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { NotificationPanel, BudgetPanel } from '@/features/operations/panels'
import { PolicyPanel } from '@/features/delivery/panels'
export default async function SettingsPage() {
  const ctx = await requireRequestContext('client')
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeading
        title="Workspace settings"
        description={`Timezone: ${ctx.timezone}. Owner-confirmed defaults and delivery automation use synthetic providers.`}
      />
      <div className="space-y-6">
        {['owner', 'admin'].includes(ctx.tenantRole) && (
          <BudgetPanel tenantId={ctx.tenantId} />
        )}
        <NotificationPanel />
        <PolicyPanel
          tenantId={ctx.tenantId}
          owner={ctx.tenantRole === 'owner'}
        />
      </div>
    </div>
  )
}

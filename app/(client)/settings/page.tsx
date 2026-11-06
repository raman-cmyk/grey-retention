import type { Metadata } from 'next'
import { Notice } from '@/components/ui/workspace'
import { requireRequestContext } from '@/features/auth/application/request-context'
import {
  NotificationPanel,
  BudgetPanel,
  HolidayPanel
} from '@/features/operations/panels'
import { PolicyPanel } from '@/features/delivery/panels'
import { settingsPage } from '@/features/settings/data'
import { DefaultsForm, TimezoneCard } from '@/features/settings/settings-form'

export const metadata: Metadata = { title: 'Settings' }

export default async function SettingsPage() {
  const ctx = await requireRequestContext('client')
  const owner = ctx.tenantRole === 'owner'
  const { now, data } = await settingsPage(ctx)
  return (
    <div className="mx-auto max-w-[900px]">
      <header className="mb-6 space-y-2">
        <h1 className="tracking-display font-serif text-[1.875rem] leading-tight font-normal">
          Settings
        </h1>
        <p className="text-sm text-[var(--text-muted)]">
          Set defaults that apply to every campaign you generate. You can still
          change them on any individual draft.
        </p>
      </header>
      <div className="space-y-6">
        <TimezoneCard timezone={ctx.timezone} initialNow={now} />
        {!data ? (
          <Notice error>Please sign in again to see your defaults.</Notice>
        ) : data.unavailable ? (
          <Notice error>
            Campaign defaults need a database update. Your campaigns still work.
          </Notice>
        ) : (
          <DefaultsForm
            defaults={data.defaults}
            products={data.products}
            audiences={data.audiences}
            audienceSource={data.audienceSource}
            owner={owner}
          />
        )}
      </div>
      <h2 className="tracking-label mt-12 mb-4 font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase">
        More settings
      </h2>
      <div className="space-y-6">
        {['owner', 'admin'].includes(ctx.tenantRole) && (
          <BudgetPanel tenantId={ctx.tenantId} />
        )}
        <NotificationPanel />
        {/* Sidebar "Holidays & Events" links here until /holidays exists. */}
        <div id="holidays" className="scroll-mt-6">
          <HolidayPanel tenantId={ctx.tenantId} owner={owner} />
        </div>
        <PolicyPanel tenantId={ctx.tenantId} owner={owner} />
      </div>
    </div>
  )
}

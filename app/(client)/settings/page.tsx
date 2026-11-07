import type { Metadata } from 'next'
import { Notice } from '@/components/ui/workspace'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { NotificationPanel, BudgetPanel } from '@/features/operations/panels'
import { PolicyPanel } from '@/features/delivery/panels'
import { settingsPage } from '@/features/settings/data'
import { brandTimezone } from '@/features/settings/timezone'
import { DefaultsForm, TimezoneCard } from '@/features/settings/settings-form'

export const metadata: Metadata = { title: 'Settings' }

const unavailableText = {
  ready: '',
  demo: 'Campaign defaults are not saved in the demo.',
  no_database: 'Campaign defaults are unavailable right now.',
  missing_table:
    'Campaign defaults need a database update. Your campaigns still work.',
  load_failed:
    'We could not load your campaign defaults. Reload the page to try again.'
} as const

export default async function SettingsPage() {
  const ctx = await requireRequestContext('client')
  const owner = ctx.tenantRole === 'owner'
  const [{ now, timezone, state, data }, zone] = await Promise.all([
    settingsPage(ctx),
    brandTimezone(ctx)
  ])
  return (
    <div className="mx-auto max-w-[900px]">
      <header className="mb-6 space-y-2">
        <h1 className="tracking-display font-serif text-[1.875rem] leading-tight font-normal">
          Settings
        </h1>
        <p className="text-sm text-[var(--text-muted)]">
          Set defaults for the campaigns you will generate. You can still change
          them on any individual draft.
        </p>
      </header>
      <div className="space-y-6">
        <TimezoneCard
          timezone={timezone}
          saved={zone.saved}
          options={zone.options}
          initialNow={now}
          source={zone.source}
          klaviyoTimezone={zone.klaviyoDiffers ? zone.klaviyoTimezone : null}
          owner={owner}
        />
        {data ? (
          <DefaultsForm
            defaults={data.defaults}
            products={data.products}
            productsState={data.productsState}
            productsSample={data.productsSample}
            audiences={data.audiences}
            audienceSource={data.audienceSource}
            owner={owner}
          />
        ) : (
          <Notice error={state !== 'demo'}>{unavailableText[state]}</Notice>
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
        <PolicyPanel tenantId={ctx.tenantId} owner={owner} />
      </div>
    </div>
  )
}

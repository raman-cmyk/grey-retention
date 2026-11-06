import type { Metadata } from 'next'
import Link from 'next/link'
import { Link2, ShoppingBag } from 'lucide-react'
import { Notice } from '@/components/ui/workspace'
import { campaignWorkspace } from '@/features/campaigns/data'
import { brandProfileData } from '@/features/brand-profile/data'
import { BrandHeader } from '@/features/brand-profile/header'

export const metadata: Metadata = { title: 'Store Intelligence' }

export default async function StorePage() {
  const { context, data, error } = await campaignWorkspace()
  if (error || !data)
    return <Notice error>{error ?? 'Store details unavailable.'}</Notice>
  const profile = await brandProfileData(context.tenantId, data.brand)
  return (
    <div className="mx-auto max-w-[920px]">
      <BrandHeader
        active="store"
        owner={context.tenantRole === 'owner'}
        lastUpdated={null}
      />
      {profile?.shopifyConnected ? (
        <section className="space-y-4 rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-6">
          <h2 className="text-lg font-semibold">Store Intelligence</h2>
          <p className="text-sm text-[var(--text-muted)]">
            Shopify is connected with sample products ({data.products.length} in
            your catalogue). Revenue trends, top customers and out-of-stock
            alerts arrive with the store dashboard in the next update.
          </p>
          <Link
            href="/brand#products"
            className="text-sm font-medium underline"
          >
            See your products
          </Link>
        </section>
      ) : (
        <section className="mx-auto max-w-xl space-y-4 rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-8 text-center">
          <span
            aria-hidden="true"
            className="bg-success-faint text-success mx-auto grid size-12 place-items-center rounded-[var(--radius-control)]"
          >
            <ShoppingBag className="size-6" />
          </span>
          <h2 className="text-lg font-semibold">
            Connect Shopify to see Store Intelligence
          </h2>
          <p className="text-sm text-[var(--text-muted)]">
            Once connected, we’ll bulk-import your products, orders, and
            customers, then render a live dashboard with revenue trends, top
            customers, and out-of-stock alerts.
          </p>
          <Link
            href="/connections"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--brand-primary)] px-4 text-sm font-medium text-[var(--on-brand)] hover:bg-[var(--brand-primary-strong)]"
          >
            <Link2 className="size-4" aria-hidden="true" />
            Go to Connections
          </Link>
        </section>
      )}
    </div>
  )
}

import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { deliveryPackageSchema } from '@/features/workflow/domain/contracts'
import { klaviyoCampaignRequest } from './klaviyo-contract'
import { PersistedFixtureDeliveryProvider } from './fixture-delivery'
const id = '00000000-0000-4000-8000-000000000001'
it('requires idempotency, returns persisted reconciliation and refuses schedule drift', async () => {
  const rpc = vi.fn(async (_name: string, args: { command: string }) => ({
    error: null,
    data:
      args.command === 'reconcile'
        ? { outcome: 'unknown' }
        : {
            id,
            packageId: id,
            state: 'scheduled',
            scheduledAt: '2030-01-01T12:00:00Z'
          }
  }))
  const provider = new PersistedFixtureDeliveryProvider(
    { rpc } as unknown as SupabaseClient<Database>,
    { id, lease_token: id, idempotency_key: 'schedule:fixture' }
  )
  const pkg = deliveryPackageSchema.parse({
    schemaVersion: 1,
    id,
    tenantId: id,
    campaignId: id,
    revision: 1,
    channel: 'email_text',
    subject: 'A note',
    preheader: '',
    text: 'Original copy',
    html: '<p>Original copy</p>',
    assetPaths: [],
    links: ['https://fixture.example'],
    footer: {
      address: '42 Fictional Lane',
      unsubscribeUrl: 'https://fixture.example/unsubscribe',
      privacyUrl: 'https://fixture.example/privacy'
    },
    audience: {
      accountId: 'fixture',
      includes: ['engaged'],
      excludes: ['suppressed']
    },
    sender: { name: 'Fictional', email: 'studio@fixture.example' },
    scheduledAt: '2030-01-01T10:00:00Z',
    timezone: 'UTC',
    approvals: { calendar: id, copy: id, design: id },
    sourceRevisions: { calendar: 1, copy: 1, design: 1 },
    createdAt: '2026-10-04T00:00:00Z',
    synthetic: true
  })
  const request = klaviyoCampaignRequest(pkg).data.attributes
  expect(request.audiences).toEqual({
    included: pkg.audience.includes,
    excluded: pkg.audience.excludes
  })
  expect(request.send_strategy.options_static.datetime).toBe(pkg.scheduledAt)
  expect(
    request['campaign-messages'].data[0].attributes.definition.content
  ).toMatchObject({
    subject: pkg.subject,
    preview_text: pkg.preheader,
    from_email: pkg.sender.email
  })
  await expect(provider.prepare(pkg, 'wrong-key')).rejects.toThrow(
    'Idempotency'
  )
  expect(rpc).not.toHaveBeenCalled()
  await expect(provider.reconcile('schedule:fixture')).resolves.toEqual({
    outcome: 'unknown'
  })
  await expect(
    provider.schedule(
      { id, packageId: id, state: 'prepared', scheduledAt: null },
      pkg.scheduledAt
    )
  ).rejects.toThrow('schedule mismatch')
})

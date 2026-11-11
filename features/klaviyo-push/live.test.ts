// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import type { DraftInput } from '@/lib/providers/klaviyo-draft'
import { databasePushStore, draftPusherFor, liveSource } from './live'

type Db = Parameters<typeof draftPusherFor>[0]
const input: DraftInput = {
  tenantId: '00000000-0000-4000-8000-000000000101',
  idempotencyKey: '6f1c2d3e-4b5a-4c6d-8e7f-0123456789ab',
  name: 'Tue 17 Nov · Offer',
  subject: 'Hello',
  preheader: '',
  html: '<p>{% unsubscribe %} {{ organization.full_address }}</p>',
  plannedSendAt: '2026-11-17T18:00:00Z',
  audienceId: 'SegEng90',
  sample: false,
  lease: {
    build: '00000000-0000-4000-8000-00000000b101',
    token: '00000000-0000-4000-8000-00000000aaaa'
  }
}

const ref = {
  tenantId: input.tenantId,
  key: input.idempotencyKey,
  build: '00000000-0000-4000-8000-00000000b101',
  lease: '00000000-0000-4000-8000-00000000aaaa'
}

/** A database that answers each RPC and table read from `answers`. */
function database(answers: Record<string, { data: unknown; error?: unknown }>) {
  const rpc = vi.fn(async (name: string) => ({
    data: answers[name]?.data ?? null,
    error: answers[name]?.error ?? null
  }))
  const from = vi.fn((table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({
        data: answers[table]?.data ?? null,
        error: null
      }),
      single: async () => ({ data: answers[table]?.data ?? null, error: null })
    }
    return chain
  })
  return { db: { rpc, from } as unknown as Db, rpc, from }
}

describe('the pusher "Create email" uses', () => {
  it('is the fake one unless the owner’s live Klaviyo switch is on', async () => {
    const { db, rpc } = database({})
    for (const env of [
      {},
      { KLAVIYO_MODE: 'fixture' },
      { KLAVIYO_MODE: 'LIVE' }
    ]) {
      const result = await draftPusherFor(db, { env }).createDraft(input)
      expect(result).toEqual({
        ok: true,
        campaignId: `sample-draft-${input.idempotencyKey}`,
        sample: true
      })
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('gives the sample store’s emails a sample draft even with the switch on, and asks for the key otherwise', async () => {
    const { db, rpc } = database({ klaviyo_api_key: { data: null } })
    const pusher = draftPusherFor(db, { env: { KLAVIYO_MODE: 'live' } })
    expect(await pusher.createDraft({ ...input, sample: true })).toMatchObject({
      ok: true,
      sample: true
    })
    expect(rpc).not.toHaveBeenCalled()
    // A workspace without a live, connected key: the owner must connect it.
    expect(await pusher.createDraft(input)).toEqual({ ok: false, code: 'auth' })
    expect(rpc).toHaveBeenCalledWith('klaviyo_api_key', { t: input.tenantId })
  })

  it('reads no key at another API revision', async () => {
    const { db, rpc } = database({ klaviyo_api_key: { data: 'pk_x' } })
    expect(
      await liveSource(db, {
        KLAVIYO_MODE: 'live',
        KLAVIYO_API_REVISION: '2025-01-15'
      }).client(input.tenantId)
    ).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('the push steps in the database', () => {
  it('saves a step under its column names through the worker-only command', async () => {
    const { db, rpc } = database({ save_klaviyo_push: { data: null } })
    await databasePushStore(db).save(ref, {
      campaignId: 'Cmp1',
      messageId: 'Msg1',
      images: { 'https://cedar.example/a.jpg': 'https://img.example/a.jpg' },
      designs: null
    })
    expect(rpc).toHaveBeenCalledWith('save_klaviyo_push', {
      build: ref.build,
      lease: ref.lease,
      step: {
        campaign_id: 'Cmp1',
        message_id: 'Msg1',
        images: { 'https://cedar.example/a.jpg': 'https://img.example/a.jpg' },
        designs: null
      }
    })
  })

  it('reads a push back, and nothing for a key never pushed', async () => {
    const row = {
      state: 'drafted',
      images: {},
      templates: [
        { approach: 'A', id: 'T1', hash: 'a'.repeat(64), deleted: true }
      ],
      campaign_id: 'Cmp1',
      message_id: 'Msg1',
      create_started_at: '2026-11-11T12:00:00Z',
      designs: 'A',
      fallback: null,
      reason: null,
      written: 'b'.repeat(64)
    }
    expect(
      await databasePushStore(
        database({ klaviyo_draft_pushes: { data: row } }).db
      ).load(ref)
    ).toEqual({
      state: 'drafted',
      images: {},
      templates: row.templates,
      campaignId: 'Cmp1',
      messageId: 'Msg1',
      createStartedAt: '2026-11-11T12:00:00Z',
      designs: 'A',
      fallback: null,
      reason: null,
      written: 'b'.repeat(64)
    })
    expect(await databasePushStore(database({}).db).load(ref)).toBeNull()
  })
})

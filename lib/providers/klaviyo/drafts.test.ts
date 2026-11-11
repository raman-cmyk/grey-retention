// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import {
  KlaviyoError,
  isDraftWrite,
  klaviyoClient,
  type KlaviyoTransport
} from './client'
import {
  createDraftCampaign,
  findOwnCampaign,
  readDraft,
  setEvenTest
} from './drafts'
import { fakeDraftAccount } from './recorded-drafts'

const key = 'pk_SAMPLE0123456789abcdefghij'
const failure = async (call: Promise<unknown>) => {
  try {
    await call
  } catch (error) {
    return error as KlaviyoError
  }
  throw new Error('expected a failure')
}

describe('the Klaviyo draft writes', () => {
  it('writes only to the addresses that make or change a draft, never a schedule or a send', async () => {
    const sent: string[] = []
    const transport: KlaviyoTransport = async (request) => {
      sent.push(`${request.method} ${new URL(request.url).pathname}`)
      return { status: 204, headers: {}, body: '' }
    }
    const client = klaviyoClient(key, { transport })
    for (const [method, path] of [
      ['POST', '/api/campaign-message-schedule'],
      ['POST', '/api/campaign-send-jobs'],
      ['PATCH', '/api/campaign-send-jobs/abc'],
      ['DELETE', '/api/campaigns/abc'],
      ['PATCH', '/api/campaigns/abc'],
      ['POST', '/api/lists'],
      ['POST', '/api/segments'],
      ['POST', '/api/profiles'],
      ['POST', '/api/campaign-message-assign-template'],
      ['POST', '/api/campaigns?include=x'],
      ['POST', 'https://other.example/api/campaigns'],
      ['DELETE', '/api/campaign-variations/../campaigns/abc']
    ] as const)
      expect(
        (
          await failure(
            client.write(
              method,
              path,
              method === 'DELETE' ? null : {},
              'campaigns:write'
            )
          )
        ).kind,
        `${method} ${path}`
      ).toBe('rejected')
    expect(sent).toEqual([])
    expect(isDraftWrite('POST', '/api/campaigns')).toBe(true)
    expect(isDraftWrite('DELETE', '/api/campaign-variations/Var1')).toBe(true)
    // A deletion has no body, a change always has one.
    expect(
      (
        await failure(
          client.write('DELETE', '/api/templates/T1', {}, 'templates:write')
        )
      ).kind
    ).toBe('rejected')
    expect(
      (
        await failure(
          client.write('POST', '/api/templates', null, 'templates:write')
        )
      ).kind
    ).toBe('rejected')
    expect(
      await client.write('DELETE', '/api/templates/T1', null, 'templates:write')
    ).toBeNull()
    expect(sent).toEqual(['DELETE /api/templates/T1'])
  })

  it('sends a write as JSON:API with the key and revision, and names a missing write scope', async () => {
    const requests: Parameters<KlaviyoTransport>[0][] = []
    const client = klaviyoClient(key, {
      transport: async (request) => {
        requests.push(request)
        return {
          status: 403,
          headers: {},
          body: '{"errors":[{"status":403,"code":"permission_denied"}]}'
        }
      }
    })
    const error = await failure(setEvenTest(client, 'Msg1'))
    expect(error).toMatchObject({
      kind: 'missing_scope',
      details: {
        scope: 'campaigns:write',
        endpoint: '/api/campaign-messages/Msg1'
      }
    })
    expect(requests[0]).toMatchObject({
      method: 'PATCH',
      headers: {
        'content-type': 'application/vnd.api+json',
        revision: '2026-10-15'
      }
    })
    expect(JSON.parse(requests[0]!.body!)).toEqual({
      data: {
        type: 'campaign-message',
        id: 'Msg1',
        attributes: { definition: { ab_test: { winner_percentage: 0 } } }
      }
    })
  })

  it('makes a draft to one audience and reads it back; a deleted one reads as gone', async () => {
    const account = fakeDraftAccount()
    const client = klaviyoClient(key, { transport: account.transport })
    const made = await createDraftCampaign(client, {
      name: 'Tue 17 Nov · Offer',
      description: 'GROS draft k1',
      audienceId: 'SegEng90',
      timezone: 'Europe/Berlin',
      variations: [
        { name: 'Design A', subject: 'S', preview: 'P', templateId: 'T1' }
      ]
    })
    expect(await readDraft(client, made.messageId)).toMatchObject({
      status: 'draft',
      campaignId: made.campaignId,
      description: 'GROS draft k1',
      winnerPercentage: null,
      variations: [{ name: 'Design A', subject: 'S', preview: 'P' }]
    })
    expect(
      await findOwnCampaign(client, {
        name: 'Tue 17 Nov · Offer',
        description: 'GROS draft k1',
        since: new Date(Date.now() - 60_000)
      })
    ).toEqual(made)
    expect(
      await findOwnCampaign(client, {
        name: 'Tue 17 Nov · Offer',
        description: 'GROS draft other',
        since: new Date(Date.now() - 60_000)
      })
    ).toBeNull()
    account.messages.clear()
    expect(await readDraft(client, made.messageId)).toBeNull()
    // No address is built from an id that is not one.
    await expect(readDraft(client, 'a/b')).rejects.toThrow()
  })
})

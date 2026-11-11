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
  audienceExists,
  campaignParts,
  createCampaign,
  createMessage,
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

  it('refuses a body that would schedule or send, whatever the address', async () => {
    const sent: string[] = []
    const client = klaviyoClient(key, {
      transport: async (request) => {
        sent.push(request.method)
        return { status: 200, headers: {}, body: '{}' }
      }
    })
    for (const body of [
      { data: { attributes: { definition: { status: 'scheduled' } } } },
      {
        data: {
          attributes: { definition: { send_options: { send_time: 'x' } } }
        }
      },
      { data: [{ attributes: { send_time: 'x' } }] }
    ])
      expect(
        (
          await failure(
            client.write(
              'PATCH',
              '/api/campaign-messages/Msg1',
              body,
              'campaigns:write'
            )
          )
        ).kind
      ).toBe('rejected')
    expect(sent).toEqual([])
  })

  it('makes a campaign, then its message, and reads it back; a deleted one reads as gone', async () => {
    const account = fakeDraftAccount()
    account.templates.set('T1', {
      name: 'T',
      html: '<p>T</p>',
      created: new Date(0).toISOString()
    })
    const client = klaviyoClient(key, { transport: account.transport })
    expect(await audienceExists(client, 'SegEng90')).toBe(true)
    expect(await audienceExists(client, 'LstNews')).toBe(true)
    expect(await audienceExists(client, 'SegGone')).toBe(false)
    const campaignId = await createCampaign(client, {
      name: 'Mother & Daughter + #2 "Say hi"',
      description: 'GROS draft k1',
      audienceId: 'SegEng90',
      timezone: 'Europe/Berlin'
    })
    const parts = await campaignParts(client, campaignId)
    expect(parts).toMatchObject({
      description: 'GROS draft k1',
      messageIds: []
    })
    const { messageId, variationIds } = await createMessage(client, {
      campaignId,
      audienceRef: parts!.audienceRef!,
      name: 'Mother & Daughter',
      variations: [
        {
          name: 'Design A',
          subject: 'S',
          preview: 'P',
          templateId: 'T1'
        }
      ]
    })
    expect(await readDraft(client, messageId)).toMatchObject({
      status: 'draft',
      campaignId,
      description: 'GROS draft k1',
      winnerPercentage: null,
      variations: [
        { id: variationIds[0], name: 'Design A', subject: 'S', preview: 'P' }
      ]
    })
    expect(variationIds).toHaveLength(1)
    // Found again by time, with its exact name and mark matched here.
    const since = new Date(Date.now() - 60_000)
    expect(
      await findOwnCampaign(client, {
        name: 'Mother & Daughter + #2 "Say hi"',
        description: 'GROS draft k1',
        since
      })
    ).toBe(campaignId)
    // Our name with another push's mark: that push's, not ours.
    expect(
      await findOwnCampaign(client, {
        name: 'Mother & Daughter + #2 "Say hi"',
        description: 'GROS draft other',
        since
      })
    ).toBeNull()
    // Our name without any mark (it was changed in Klaviyo): never guessed.
    account.campaigns.get(campaignId)!.description = 'Edited'
    expect(
      await findOwnCampaign(client, {
        name: 'Mother & Daughter + #2 "Say hi"',
        description: 'GROS draft k1',
        since
      })
    ).toBe('ambiguous')
    account.messages.clear()
    expect(await readDraft(client, messageId)).toBeNull()
    // No address is built from an id that is not one.
    await expect(readDraft(client, 'a/b')).rejects.toThrow()
  })

  it('looks through every page of campaigns, and never guesses past the last one it read', async () => {
    const account = fakeDraftAccount({ pageSize: 2 })
    const client = klaviyoClient(key, { transport: account.transport })
    for (let i = 0; i < 5; i++)
      await createCampaign(client, {
        name: `Email ${i}`,
        description: `GROS draft k${i}`,
        audienceId: 'SegEng90',
        timezone: 'UTC'
      })
    const since = new Date(Date.now() - 60_000)
    // The fake answers 2 a page: the oldest is on the third.
    expect(
      await findOwnCampaign(client, {
        name: 'Email 0',
        description: 'GROS draft k0',
        since
      })
    ).toEqual(expect.stringMatching(/^Cmp/))
    expect(
      await findOwnCampaign(
        client,
        { name: 'Email 0', description: 'GROS draft k0', since },
        2
      )
    ).toBe('ambiguous')
  })

  it('reads a partial answer as unknown, never as no variations', async () => {
    const account = fakeDraftAccount({ faults: { dropRelationships: true } })
    account.templates.set('T1', {
      name: 'T',
      html: '<p>T</p>',
      created: new Date(0).toISOString()
    })
    const client = klaviyoClient(key, { transport: account.transport })
    const campaignId = await createCampaign(client, {
      name: 'N',
      description: 'D',
      audienceId: 'SegEng90',
      timezone: 'UTC'
    })
    const parts = await campaignParts(client, campaignId)
    const { messageId } = await createMessage(client, {
      campaignId,
      audienceRef: parts!.audienceRef!,
      name: 'N',
      variations: [
        {
          name: 'Design A',
          subject: 'S',
          preview: 'P',
          templateId: 'T1'
        }
      ]
    })
    expect((await failure(readDraft(client, messageId))).kind).toBe(
      'invalid_response'
    )
  })
})

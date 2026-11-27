// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { liveDraftPusher, type PushStore } from '@/features/klaviyo-push/pusher'
import {
  KlaviyoError,
  fetchTransport,
  klaviyoClient,
  readOnlyRequest,
  reportQuestionPaths,
  type KlaviyoTransport
} from './client'
import {
  createCampaign,
  createMessage,
  createTemplate,
  deleteTemplate,
  deleteVariation,
  importImage,
  setEvenTest,
  updateVariation
} from './drafts'

/**
 * KLV-LOCK-001: the Klaviyo write lock. A synthetic full-access key (an
 * obviously made-up value, never a real one), the owner's live switches
 * both on, and a spy transport: while locked, no write leaves the app.
 */
const fullAccessKey = 'pk_FAKEFULLSCOPETESTKEY0000000000'
const host = 'https://a.klaviyo.com'

function spy() {
  const calls: { method: string; url: string }[] = []
  const transport: KlaviyoTransport = async (request) => {
    calls.push({ method: request.method, url: request.url })
    return {
      status: 200,
      headers: {},
      body: JSON.stringify({ data: { type: 'template', id: 'Tpl1' } })
    }
  }
  return { calls, client: klaviyoClient(fullAccessKey, { transport }) }
}
const failure = async (call: Promise<unknown>) => {
  try {
    await call
  } catch (error) {
    return error as KlaviyoError
  }
  throw new Error('expected a failure')
}
const locked = async (call: Promise<unknown>) => {
  const error = await failure(call)
  expect(error).toBeInstanceOf(KlaviyoError)
  expect(error.kind).toBe('write_locked')
  // Never the key, in the message or the details.
  expect(JSON.stringify({ m: error.message, d: error.details })).not.toContain(
    fullAccessKey
  )
}

beforeEach(() => {
  vi.stubEnv('KLAVIYO_MODE', 'live')
  vi.stubEnv('KLAVIYO_DRAFT_PUSH', 'live')
  vi.stubEnv('KLAVIYO_WRITE_LOCK', undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('while Klaviyo is locked (the default)', () => {
  it('refuses every write with no request at all, whatever the live switches say', async () => {
    const { calls, client } = spy()
    const variation = {
      name: 'Design A',
      subject: 'S',
      preview: 'P',
      templateId: 'Tpl1'
    }
    for (const call of [
      () => createTemplate(client, 'GROS 1 A', '<p>x</p>'),
      () => deleteTemplate(client, 'Tpl1'),
      () => importImage(client, 'https://cedar.example/a.jpg', 'GROS 1'),
      () =>
        createCampaign(client, {
          name: 'N',
          description: 'GROS draft k',
          audienceId: 'LstAll',
          timezone: 'UTC'
        }),
      () =>
        createMessage(client, {
          campaignId: 'Cmp1',
          audienceRef: 'LstAll',
          name: 'N',
          variations: [variation]
        }),
      () => setEvenTest(client, 'Msg1'),
      () => updateVariation(client, 'Var1', variation),
      () => deleteVariation(client, 'Var1'),
      // A segment, a profile and a list write (never draft writes at all).
      () =>
        client.write('POST', '/api/segments', { data: {} }, 'segments:write'),
      () =>
        client.write('POST', '/api/profiles', { data: {} }, 'campaigns:write'),
      () => client.write('POST', '/api/lists', { data: {} }, 'campaigns:write'),
      // A body that carries a schedule, and a send job.
      () =>
        client.write(
          'PATCH',
          '/api/campaign-messages/Msg1',
          {
            data: {
              attributes: {
                definition: { send_options: { send_strategy: 'static' } }
              }
            }
          },
          'campaigns:write'
        ),
      () =>
        client.write(
          'POST',
          '/api/campaign-send-jobs',
          { data: { type: 'campaign-send-job', id: 'Cmp1' } },
          'campaigns:write'
        )
    ])
      await locked(call())
    expect(calls).toEqual([])
  })

  it('makes no draft at all, without reading the key, and never tries again', async () => {
    const store: PushStore = {
      load: vi.fn(async () => null),
      save: vi.fn(async () => {})
    }
    const source = { client: vi.fn(), timezone: vi.fn() }
    const result = await liveDraftPusher({ source, store }).createDraft({
      tenantId: '00000000-0000-4000-8000-000000000101',
      idempotencyKey: '6f1c2d3e-4b5a-4c6d-8e7f-0123456789ab',
      name: 'N',
      subject: 'S',
      preheader: 'P',
      html: '<p>x</p>',
      plannedSendAt: '2026-11-17T18:00:00Z',
      audienceId: 'SegEng90',
      sample: false,
      lease: { build: '00000000-0000-4000-8000-00000000b101', token: 'l' },
      contentChecked: true
    })
    expect(result).toEqual({
      ok: false,
      code: 'rejected',
      checks: ['write_lock'],
      reason: 'testing_write_lock'
    })
    expect(source.client).not.toHaveBeenCalled()
    expect(store.save).not.toHaveBeenCalled()
  })

  it('still reads: GETs, Klaviyo’s next links and each report question at its exact address', async () => {
    const { calls, client } = spy()
    await client.get('/api/accounts', 'accounts:read')
    await client.next(`${host}/api/campaigns?page[cursor]=x`, 'campaigns:read')
    for (const path of reportQuestionPaths)
      await client.query(path, { data: {} }, 'campaigns:read')
    expect(calls).toEqual([
      { method: 'GET', url: `${host}/api/accounts` },
      { method: 'GET', url: `${host}/api/campaigns?page[cursor]=x` },
      { method: 'POST', url: `${host}/api/campaign-values-reports` },
      { method: 'POST', url: `${host}/api/flow-values-reports` },
      { method: 'POST', url: `${host}/api/metric-aggregates` }
    ])
  })

  it('stays locked for any value but exactly "unlocked"', async () => {
    for (const value of [
      undefined,
      '',
      ' ',
      'Unlocked',
      'UNLOCKED',
      ' unlocked',
      'unlocked ',
      'unlocked\n',
      'un locked',
      'unlock',
      'true',
      'false',
      'off',
      'on',
      '0',
      '1',
      'no',
      'yes',
      'locked',
      '"unlocked"'
    ]) {
      vi.stubEnv('KLAVIYO_WRITE_LOCK', value)
      const { calls, client } = spy()
      await locked(createTemplate(client, 'GROS 1 A', '<p>x</p>'))
      expect(calls).toEqual([])
    }
  })
})

/** Report-like addresses and other spellings, none exactly a report's. */
const notReports = [
  '/api/campaign-values-reports-x',
  '/api/campaign-values-reportsX/',
  '/api/segments-reports',
  '/api/campaign-values-reports/',
  '/API/campaign-values-reports',
  '/api/Campaign-Values-Reports',
  '/api/campaign-values-reports?x=1',
  '/api/%63ampaigns',
  '/api/campaign%2dvalues-reports',
  '/api/campaign-values-reports%2f',
  '/api/campaign-values-reports/../campaigns',
  '/api/./campaign-values-reports',
  '//api/campaign-values-reports'
]
/** Addresses on another origin, or with a user in them. */
const otherOrigins = [
  'http://a.klaviyo.com/api/metric-aggregates',
  'https://a.klaviyo.com:444/api/metric-aggregates',
  'https://evil.example/api/metric-aggregates',
  'https://a.klaviyo.com.evil.example/api/metric-aggregates',
  'https://user:pass@a.klaviyo.com/api/metric-aggregates',
  'https://user@a.klaviyo.com/api/metric-aggregates'
]
const otherMethods = [
  'PUT',
  'OPTIONS',
  'post',
  'Post',
  'HEAD',
  'PATCH',
  'DELETE'
]

describe('the lock’s exact allowlist, against tricky addresses and methods', () => {
  it('lets through only an exact GET on Klaviyo and an exact POST of the three reports', () => {
    expect(reportQuestionPaths).toEqual([
      '/api/campaign-values-reports',
      '/api/flow-values-reports',
      '/api/metric-aggregates'
    ])
    for (const path of reportQuestionPaths) {
      expect(readOnlyRequest('POST', `${host}${path}`)).toBe(true)
      for (const method of otherMethods)
        expect(readOnlyRequest(method, `${host}${path}`)).toBe(false)
    }
    for (const path of notReports)
      expect(readOnlyRequest('POST', `${host}${path}`)).toBe(false)
    for (const url of otherOrigins) {
      expect(readOnlyRequest('POST', url)).toBe(false)
      expect(readOnlyRequest('GET', url)).toBe(false)
    }
    expect(readOnlyRequest('GET', `${host}/api/accounts`)).toBe(true)
    expect(readOnlyRequest('get', `${host}/api/accounts`)).toBe(false)
    expect(readOnlyRequest('GET', 'not a url')).toBe(false)
  })

  it('refuses them through the client, with no request', async () => {
    const { calls, client } = spy()
    for (const path of notReports) {
      // As a report question: not one (the client's own rule).
      expect(
        (await failure(client.query(path, { data: {} }, 'campaigns:read'))).kind
      ).toBe('rejected')
      // As a write of any kind: the lock.
      await locked(client.write('POST', path, { data: {} }, 'campaigns:write'))
    }
    for (const url of otherOrigins) {
      expect(
        (await failure(client.query(url, { data: {} }, 'campaigns:read'))).kind
      ).toBe('rejected')
      // Another host is never followed; Klaviyo's own with a user in the
      // address is the lock's (in the client's send, before the transport).
      const next = await failure(client.next(url, 'campaigns:read'))
      if (url.includes('@')) await locked(Promise.reject(next))
      else expect(next.kind).toBe('invalid_response')
      await locked(client.write('POST', url, { data: {} }, 'campaigns:write'))
    }
    for (const path of reportQuestionPaths)
      for (const method of otherMethods)
        await locked(
          client.write(
            method as 'POST',
            path,
            method === 'DELETE' ? null : { data: {} },
            'campaigns:write'
          )
        )
    expect(calls).toEqual([])
  })

  it('refuses them in fetchTransport itself, with no request', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const send = (method: string, url: string) =>
      fetchTransport({
        method: method as 'POST',
        url,
        headers: { authorization: `Klaviyo-API-Key ${fullAccessKey}` },
        body: '{}',
        timeoutMs: 1_000
      })
    await locked(send('PATCH', `${host}/api/campaign-messages/Msg1`))
    for (const path of notReports) await locked(send('POST', `${host}${path}`))
    for (const url of otherOrigins) {
      await locked(send('POST', url))
      await locked(send('GET', url))
    }
    for (const path of reportQuestionPaths)
      for (const method of otherMethods)
        await locked(send(method, `${host}${path}`))
    for (const path of ['/api/templates', '/api/campaigns', '/api/images'])
      await locked(send('POST', `${host}${path}`))
    expect(fetch).not.toHaveBeenCalled()
    // Reads still go out.
    await send('GET', `${host}/api/accounts`)
    for (const path of reportQuestionPaths) await send('POST', `${host}${path}`)
    expect(fetch).toHaveBeenCalledTimes(4)
  })
})

describe('a transport’s own refusal', () => {
  it('is passed on as the lock’s, never as Klaviyo being unwell', async () => {
    const client = klaviyoClient(fullAccessKey, {
      transport: async () => {
        throw new KlaviyoError('write_locked', { endpoint: '/api/accounts' })
      }
    })
    await locked(client.get('/api/accounts', 'accounts:read'))
  })
})

describe('with the lock released by the server (exactly "unlocked")', () => {
  beforeEach(() => vi.stubEnv('KLAVIYO_WRITE_LOCK', 'unlocked'))

  it('writes a draft as before, and still refuses what is no draft write', async () => {
    const { calls, client } = spy()
    expect(await createTemplate(client, 'GROS 1 A', '<p>x</p>')).toBe('Tpl1')
    expect(calls).toEqual([{ method: 'POST', url: `${host}/api/templates` }])
    expect(
      (
        await failure(
          client.write('POST', '/api/segments', { data: {} }, 'segments:write')
        )
      ).kind
    ).toBe('rejected')
    expect(calls).toHaveLength(1)
    // PICK-101: GROS's own list-hygiene segment is the one segment write.
    await client
      .write(
        'POST',
        '/api/segments',
        {
          data: {
            type: 'segment',
            attributes: {
              name: 'GROS list hygiene · 180 days · v1',
              definition: { condition_groups: [] },
              is_starred: false
            }
          }
        },
        'segments:write'
      )
      .catch(() => null)
    expect(calls).toEqual([
      { method: 'POST', url: `${host}/api/templates` },
      { method: 'POST', url: `${host}/api/segments` }
    ])
  })

  it('never lets fetchTransport send the key off Klaviyo', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    for (const url of otherOrigins)
      expect(
        (
          await failure(
            fetchTransport({
              method: 'GET',
              url,
              headers: {},
              timeoutMs: 1_000
            })
          )
        ).kind
      ).toBe('invalid_response')
    expect(fetch).not.toHaveBeenCalled()
  })
})

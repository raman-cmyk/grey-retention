// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import {
  fetchTransport,
  klaviyoClient,
  type KlaviyoTransport,
  type KlaviyoWriteMethod
} from './client'
import {
  createCampaign,
  createTemplate,
  deleteTemplate,
  deleteVariation,
  importImage,
  setEvenTest
} from './drafts'

// Synthetic key only; these tests never contact an account.
const key = 'pk_SAMPLE0123456789abcdefghij'
const host = 'https://a.klaviyo.com'
const reports = [
  '/api/campaign-values-reports',
  '/api/flow-values-reports',
  '/api/metric-aggregates'
]
const mutations: [string, string][] = [
  ['POST', '/api/campaigns'],
  ['POST', '/api/campaign-messages'],
  ['POST', '/api/templates'],
  ['POST', '/api/images'],
  ['PATCH', '/api/campaign-messages/M1'],
  ['PATCH', '/api/campaign-variations/V1'],
  ['DELETE', '/api/campaign-variations/V1'],
  ['DELETE', '/api/templates/T1'],
  ['POST', '/api/segments'],
  ['POST', '/api/profiles'],
  ['POST', '/api/lists'],
  ['POST', '/api/profile-subscription-bulk-create-jobs'],
  ['DELETE', '/api/campaigns/C1'],
  ['POST', '/api/campaign-send-jobs'],
  ['POST', '/api/campaign-message-schedule'],
  ['PUT', '/api/templates/T1'],
  ['OPTIONS', '/api/campaign-values-reports'],
  ['post', '/api/campaign-values-reports'],
  ['GET', '/api/accounts'] // A GET with a body is not an allowed read.
]
const request = (method: string, path: string) => ({
  method: method as Parameters<KlaviyoTransport>[0]['method'],
  url: `${host}${path}`,
  headers: { authorization: `Klaviyo-API-Key ${key}` },
  ...(method !== 'DELETE' ? { body: '{}' } : {}),
  timeoutMs: 1000
})

beforeEach(() => {
  vi.stubEnv('KLAVIYO_WRITE_LOCK', undefined)
  vi.stubEnv('KLAVIYO_MODE', 'live')
  vi.stubEnv('KLAVIYO_DRAFT_PUSH', 'live')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}'))
  )
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('KLV-LOCK-001: server-owned read-only testing', () => {
  it.each([
    undefined,
    '',
    'locked',
    'off',
    'false',
    '0',
    'UNLOCKED',
    'unlocked '
  ])(
    'fails closed for the setting %s even with both live flags on',
    async (value) => {
      vi.stubEnv('KLAVIYO_WRITE_LOCK', value)
      const transport = vi.fn<KlaviyoTransport>()
      await expect(
        klaviyoClient(key, { transport }).write(
          'POST',
          '/api/templates',
          { data: {} },
          'templates:write'
        )
      ).rejects.toMatchObject({ kind: 'write_locked' })
      expect(transport).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    }
  )

  it('blocks the real adapter entrypoints before an injected transport', async () => {
    const transport = vi.fn<KlaviyoTransport>()
    const client = klaviyoClient(key, { transport })
    for (const call of [
      () =>
        createCampaign(client, {
          name: 'Synthetic draft',
          description: 'Synthetic test',
          audienceId: 'S1',
          timezone: 'UTC'
        }),
      () => createTemplate(client, 'Synthetic', '<p>Test</p>'),
      () =>
        importImage(client, 'https://shop.example/product.png', 'Synthetic'),
      () => deleteTemplate(client, 'T1'),
      () => deleteVariation(client, 'V1'),
      () => setEvenTest(client, 'M1')
    ])
      await expect(call()).rejects.toMatchObject({ kind: 'write_locked' })
    for (const [method, path] of mutations)
      await expect(
        client.write(
          method as KlaviyoWriteMethod,
          path,
          method === 'DELETE' ? null : {},
          'campaigns:write'
        )
      ).rejects.toMatchObject({ kind: 'write_locked' })
    await expect(
      client.write(
        'POST',
        '/api/campaigns',
        {
          data: { attributes: { send_time: '2026-12-01T10:00:00Z' } }
        },
        'campaigns:write'
      )
    ).rejects.toMatchObject({ kind: 'write_locked' })
    expect(transport).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(mutations)(
    'blocks raw transport %s %s before fetch',
    async (method, path) => {
      await expect(fetchTransport(request(method, path))).rejects.toMatchObject(
        {
          kind: 'write_locked'
        }
      )
      expect(fetch).not.toHaveBeenCalled()
    }
  )

  it('allows normal GET pagination and only the three exact report POSTs', async () => {
    const transport = vi.fn<KlaviyoTransport>(async () => ({
      status: 200,
      headers: {},
      body: '{}'
    }))
    const client = klaviyoClient(key, { transport })
    await client.get('/api/accounts', 'accounts:read')
    await client.next(`${host}/api/events/?page%5Bcursor%5D=abc`, 'events:read')
    for (const path of reports) {
      await client.query(path, { data: {} }, 'metrics:read')
      await fetchTransport(request('POST', path))
    }
    await fetchTransport({
      ...request('GET', '/api/accounts'),
      body: undefined
    })
    expect(transport).toHaveBeenCalledTimes(5)
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it.each([
    '/api/campaign-values-reports/',
    '/api/Campaign-values-reports',
    '/api/campaign-values-reports-extra',
    '/api/segment-delete-reports',
    '/api/form-values-reports',
    '/api/campaign-values-reports?send=true',
    '/api/campaign-values-reports#fragment',
    '/api/%63ampaign-values-reports',
    '/api/%2563ampaign-values-reports',
    '/api/../api/campaign-values-reports',
    '/api/x/../../api/campaign-values-reports',
    '/api/x/%2e%2e/campaign-values-reports',
    '/api//campaign-values-reports',
    '/api/metric-aggregates%2f..%2fcampaigns',
    '/api/metric-aggregates;campaigns',
    '/api\\campaign-values-reports'
  ])('refuses report-like path %s at both boundaries', async (path) => {
    const transport = vi.fn<KlaviyoTransport>()
    await expect(
      klaviyoClient(key, { transport }).query(path, {}, 'metrics:read')
    ).rejects.toThrow()
    await expect(fetchTransport(request('POST', path))).rejects.toThrow()
    expect(transport).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    'https://a.klaviyo.com.evil.example/api/accounts',
    'https://a.klaviyo.com@evil.example/api/accounts',
    'https://user:password@a.klaviyo.com/api/accounts',
    'http://a.klaviyo.com/api/accounts',
    'https://127.0.0.1/api/accounts',
    'https://a.klaviyo.com:444/api/accounts',
    'https://a.klaviyo.com/api/accounts#x',
    `${host}/api/accounts?x=${'a'.repeat(8200)}`
  ])('refuses unsafe raw targets and client next links (%#)', async (url) => {
    const transport = vi.fn<KlaviyoTransport>()
    await expect(
      klaviyoClient(key, { transport }).next(url, 'accounts:read')
    ).rejects.toThrow()
    await expect(
      fetchTransport({
        ...request('GET', '/api/accounts'),
        url,
        body: undefined
      })
    ).rejects.toThrow()
    expect(transport).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('requires the separate explicit unlock and still refuses send/schedule/raw bypasses', async () => {
    vi.stubEnv('KLAVIYO_WRITE_LOCK', 'unlocked')
    const transport = vi.fn<KlaviyoTransport>(async () => ({
      status: 204,
      headers: {},
      body: ''
    }))
    await klaviyoClient(key, { transport }).write(
      'POST',
      '/api/templates',
      {},
      'templates:write'
    )
    await fetchTransport(request('POST', '/api/templates'))
    for (const path of [
      '/api/campaign-send-jobs',
      '/api/profiles',
      '/api/segments'
    ])
      await expect(fetchTransport(request('POST', path))).rejects.toMatchObject(
        { kind: 'rejected' }
      )
    await expect(
      fetchTransport({
        ...request('POST', '/api/campaigns'),
        body: JSON.stringify({ data: { status: 'scheduled' } })
      })
    ).rejects.toMatchObject({ kind: 'rejected' })
    for (const [method, body] of [
      ['post', '{}'],
      ['OPTIONS', '{}'],
      ['POST', '{broken'],
      [
        'POST',
        JSON.stringify({ data: [{ attributes: { scheduled_at: 'later' } }] })
      ]
    ])
      await expect(
        fetchTransport({ ...request(method!, '/api/templates'), body })
      ).rejects.toMatchObject({ kind: 'rejected' })
    expect(transport).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('checks the lock again after rate-limit waiting and preserves the refusal', async () => {
    vi.stubEnv('KLAVIYO_WRITE_LOCK', 'unlocked')
    const transport = vi.fn<KlaviyoTransport>(async () => ({
      status: 429,
      headers: { 'retry-after': '1' },
      body: '{}'
    }))
    const client = klaviyoClient(key, {
      transport,
      wait: async () => {
        vi.stubEnv('KLAVIYO_WRITE_LOCK', 'locked')
      }
    })
    await expect(
      client.write('POST', '/api/templates', {}, 'templates:write')
    ).rejects.toMatchObject({ kind: 'write_locked' })
    expect(transport).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
  })
})

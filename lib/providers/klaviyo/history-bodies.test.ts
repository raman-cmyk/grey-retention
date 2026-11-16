// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { klaviyoClient, type KlaviyoTransport } from './client'
import {
  maxBodyChars,
  maxBodyReads,
  readCampaignMessages,
  readMessageBodies,
  templateBodyPath
} from './history'
import { recordedHistoryTransport } from './recorded-history'

/** PIC-23: the words of what the store sent, from each email's template. */
const key = 'pk_SAMPLE0123456789abcdefghij'
const now = new Date('2026-11-11T12:00:00Z')
const lastYear = new Date(now.getTime() - 365 * 86_400_000)
const always = () => true
const client = (transport: KlaviyoTransport) =>
  klaviyoClient(key, { transport, maxWaits: 0 })
const sent = async (transport: KlaviyoTransport) =>
  (await readCampaignMessages(client(transport), 'sent', lastYear, always))
    .records

describe('the words of the sent emails (PIC-23)', () => {
  it('reads each email’s template once, by the id its variation names', async () => {
    const transport = recordedHistoryTransport({ now })
    const messages = await sent(transport)
    expect(messages.find((m) => m.id === 'MsgA08')?.templateId).toBe(
      'TplMsgA08'
    )
    transport.calls.length = 0
    const read = await readMessageBodies(client(transport), messages, always)
    expect(read).toMatchObject({
      complete: true,
      skipped: 0,
      gone: 0,
      noTemplate: 0,
      scopeMissing: false
    })
    expect(read.records).toHaveLength(messages.length)
    const letter = read.records.find((r) => r.messageId === 'MsgA08')!
    expect(letter).toMatchObject({
      templateId: 'TplMsgA08',
      editor: 'rich_text',
      truncated: false
    })
    expect(letter.text).toContain('I started Cedar Goods in my garage')
    // Only the exact address of each template, as a GET.
    expect(transport.calls).toEqual(
      messages.map((m) => `GET ${templateBodyPath(m.templateId!)}`)
    )
  })

  it('counts a template gone and a message with none, and goes on', async () => {
    const transport = recordedHistoryTransport({
      now,
      templatesGone: ['MsgA03']
    })
    const messages = await sent(transport)
    const read = await readMessageBodies(
      client(transport),
      [
        ...messages,
        { id: 'MsgSms', templateId: 'TplSms', channel: 'sms' },
        { id: 'MsgNone', templateId: null, channel: 'email' }
      ],
      always
    )
    expect(read).toMatchObject({ gone: 1, noTemplate: 2, complete: true })
    expect(read.records.map((r) => r.messageId)).not.toContain('MsgA03')
  })

  it('stops, never throwing, when the key cannot read templates, or there is no more time', async () => {
    const transport = recordedHistoryTransport({ now, noTemplateScope: true })
    const messages = await sent(transport)
    transport.calls.length = 0
    const read = await readMessageBodies(client(transport), messages, always)
    expect(read).toMatchObject({
      records: [],
      scopeMissing: true,
      complete: false
    })
    expect(transport.calls).toHaveLength(1)
    let asked = 0
    const cut = await readMessageBodies(
      client(recordedHistoryTransport({ now })),
      messages,
      () => ++asked <= 2
    )
    expect(cut).toMatchObject({ complete: false })
    expect(cut.records).toHaveLength(2)
  })

  it('reads at most its cap, caps a long body, and refuses a bad id', async () => {
    const transport = recordedHistoryTransport({ now })
    const messages = await sent(transport)
    // Templates of their own (gone from the recorded account): each read.
    const many = Array.from({ length: maxBodyReads + 5 }, (_, i) => ({
      id: `Msg${i}`,
      templateId: `TplNone${i}`,
      channel: 'email'
    }))
    const read = await readMessageBodies(client(transport), many, always)
    expect(read.records.length + read.gone).toBe(maxBodyReads)
    expect(read.complete).toBe(false)
    // Two emails of one template: one read.
    const twice = [messages[0]!, { ...messages[0]!, id: 'MsgCopy' }]
    const once = await readMessageBodies(client(transport), twice, always)
    expect(once.records).toHaveLength(1)
    expect(() => templateBodyPath('../x')).toThrow()
  })

  it('a too-big or unknown answer: a partial read, never a pause', async () => {
    const big = recordedHistoryTransport({
      now,
      fail: {
        on: 'templates',
        with: { status: 502, headers: {}, body: '' }
      }
    })
    const messages = await sent(big)
    const read = await readMessageBodies(client(big), messages, always)
    expect(read).toMatchObject({ records: [], complete: false })
    const odd = recordedHistoryTransport({
      now,
      fail: {
        on: 'templates',
        with: {
          status: 200,
          headers: { 'content-type': 'application/vnd.api+json' },
          body: JSON.stringify({ data: { type: 'flow' } })
        }
      }
    })
    const skipped = await readMessageBodies(client(odd), messages, always)
    expect(skipped.skipped).toBe(messages.length)
    expect(skipped.complete).toBe(true)
  })

  it('caps a long body, skips an answer for another template, and throws only for a bad key or too many requests', async () => {
    const answer = (attributes: Record<string, unknown>, id = 'TplMsgA08') => ({
      status: 200,
      headers: { 'content-type': 'application/vnd.api+json' },
      body: JSON.stringify({
        data: { type: 'template', id, attributes }
      })
    })
    const one = [{ id: 'MsgA08', templateId: 'TplMsgA08', channel: 'email' }]
    const long = recordedHistoryTransport({
      now,
      fail: {
        on: 'templates',
        with: answer({
          editor_type: 'CODE',
          html: 'x'.repeat(maxBodyChars + 10),
          text: null,
          updated: 'not a date'
        })
      }
    })
    const capped = await readMessageBodies(client(long), one, always)
    expect(capped.records[0]).toMatchObject({ truncated: true, updated: null })
    expect(capped.records[0]!.html).toHaveLength(maxBodyChars)
    const other = recordedHistoryTransport({
      now,
      fail: { on: 'templates', with: answer({ html: '<p>x</p>' }, 'TplOther') }
    })
    expect((await readMessageBodies(client(other), one, always)).skipped).toBe(
      1
    )
    for (const status of [401, 429]) {
      const refused = recordedHistoryTransport({
        now,
        fail: {
          on: 'templates',
          with: {
            status,
            headers: { 'retry-after': '120' },
            body: JSON.stringify({ errors: [{ status }] })
          }
        }
      })
      await expect(
        readMessageBodies(client(refused), one, always)
      ).rejects.toMatchObject({
        kind: status === 401 ? 'bad_key' : 'rate_limited'
      })
    }
    // A refusal for one template (400) is counted, never a stop.
    const odd = recordedHistoryTransport({
      now,
      fail: {
        on: 'templates',
        with: { status: 400, headers: {}, body: '{}' }
      }
    })
    expect((await readMessageBodies(client(odd), one, always)).skipped).toBe(1)
  })

  it('one template Klaviyo cannot give is counted; two in a row stop the read', async () => {
    let n = 0
    const base = recordedHistoryTransport({ now })
    const flaky = (async (request) => {
      if (
        new URL(request.url).pathname.startsWith('/api/templates/') &&
        ++n === 1
      )
        return { status: 502, headers: {}, body: '' }
      return base(request)
    }) as KlaviyoTransport
    const messages = await sent(base)
    const read = await readMessageBodies(client(flaky), messages, always)
    expect(read).toMatchObject({ skipped: 1, complete: true })
    expect(read.records).toHaveLength(messages.length - 1)
  })

  it('a template id it could not ask for is none', async () => {
    const transport = recordedHistoryTransport({ now })
    const messages = await sent(transport)
    expect(messages.every((m) => m.templateId?.startsWith('Tpl'))).toBe(true)
    expect(templateBodyPath('TplMsgA08')).toBe(
      '/api/templates/TplMsgA08?fields[template]=editor_type,html,text,updated'
    )
  })
})

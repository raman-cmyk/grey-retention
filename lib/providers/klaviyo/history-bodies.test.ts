// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { klaviyoClient, type KlaviyoTransport } from './client'
import {
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
      editor: 'text',
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
    const many = Array.from({ length: maxBodyReads + 5 }, (_, i) => ({
      ...messages[i % messages.length]!,
      id: `Msg${i}`
    }))
    const read = await readMessageBodies(client(transport), many, always)
    expect(read.records).toHaveLength(maxBodyReads)
    expect(read.complete).toBe(false)
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
})

// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import {
  KlaviyoError,
  type KlaviyoClient
} from '@/lib/providers/klaviyo/client'
import type {
  CampaignMessage,
  MessageBody
} from '@/lib/providers/klaviyo/history'
import {
  ownerEditsOf,
  readOwnerEdits,
  withoutNames,
  type SentBuild
} from './edits'

const tenant = '00000000-0000-4000-8000-000000000101'
const own = ['Cedar Goods']
/** Two emails with the same words count once: each says its own line. */
const notes: Record<string, string> = {
  MsgA: 'We ship on Fridays.',
  MsgB: 'We pack every box ourselves.',
  MsgC: 'We answer every letter.',
  MsgD: 'We grow our own cotton.'
}
const letter = (extra: string, id = 'MsgA') =>
  `<p>${notes[id] ?? ''}</p><p>Hi {{ first_name|default:"friend" }},</p><p>I started Cedar Goods in my garage with one ${extra}sewing machine and a lot of stubbornness. Every shirt still gets checked by hand before it ships.</p><p>Thank you for being here. If you ever have a question, just hit reply. I read every one.</p><p>Warmly,<br>Maya</p>`

const message = (id: string, over: Partial<CampaignMessage> = {}) =>
  ({
    id,
    campaignId: `Cmp${id}`,
    campaignName: null,
    archived: false,
    name: null,
    status: 'sent',
    sendAt: '2026-10-11T10:00:00.000Z',
    strategy: 'static',
    channel: 'email',
    subject: 'A note from our founder',
    preview: 'Why we started Cedar Goods.',
    contentKnown: true,
    abTest: false,
    templateId: `Tpl${id}`,
    ...over
  }) satisfies CampaignMessage

const build = (over: Partial<SentBuild> & Record<string, unknown> = {}) => ({
  sample: false,
  ai: true,
  name: 'Founder note',
  subject: 'A note from our founder',
  preheader: 'Why we started Cedar Goods.',
  html: letter('truly amazing '),
  approach: 'A',
  copy: 'written',
  plannedSendAt: '2026-10-11T10:00:00Z',
  audienceId: 'a1',
  productIds: [],
  code: null,
  changes: [],
  ...over
})

const template = (
  id: string,
  html: string,
  updated = '2026-10-10T10:00:00Z'
) => ({
  data: {
    type: 'template',
    id,
    attributes: { editor_type: 'CODE', html, text: null, updated }
  }
})

/** A Klaviyo client whose template reads answer from `answers`. */
function klaviyo(answers: Record<string, unknown>) {
  const asked: string[] = []
  const client = {
    get: async (path: string) => {
      const id = /\/api\/templates\/([^?]+)/.exec(path)?.[1] ?? ''
      asked.push(id)
      const a = answers[id]
      if (a instanceof Error) throw a
      if (a === undefined)
        throw new KlaviyoError('rejected', {
          endpoint: '/api/templates/',
          status: 404
        })
      return a
    },
    next: async () => ({}),
    write: async () => null
  }
  return { client: client as unknown as KlaviyoClient, asked }
}

type Row = Record<string, unknown>
/** The pushes and builds as the tables hold them; records every filter. */
function database(pushes: Row[], builds: Row[]) {
  const calls: [string, string, unknown[]][] = []
  const db = {
    from: (table: string) => {
      const rows = table === 'klaviyo_draft_pushes' ? pushes : builds
      const query: Record<string, unknown> = {
        then: (done: (r: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(done)
      }
      for (const name of ['select', 'eq', 'not', 'in', 'order', 'limit'])
        query[name] = (...args: unknown[]) => {
          calls.push([table, name, args])
          return query
        }
      return query
    }
  }
  return { db: db as never, calls }
}

const pushRow = (id: string) => ({ push_key: `push-${id}`, message_id: id })
const buildRow = (
  id: string,
  email: unknown,
  created = '2026-10-10T10:00:00Z'
) => ({
  push_key: `push-${id}`,
  email,
  created_at: created
})

/** The read over `ids` (each a sent GROS email), with what Klaviyo sent. */
async function read(
  ids: string[],
  opts: {
    sent?: Record<string, Partial<CampaignMessage>>
    builds?: Row[]
    answers?: Record<string, unknown>
    sentComplete?: boolean
  } = {}
) {
  const { db, calls } = database(
    ids.map(pushRow),
    opts.builds ??
      ids.map((id) =>
        buildRow(id, build({ html: letter('truly amazing ', id) }))
      )
  )
  const { client, asked } = klaviyo(
    opts.answers ??
      Object.fromEntries(
        ids.map((id) => [`Tpl${id}`, template(`Tpl${id}`, letter('', id))])
      )
  )
  const out = await readOwnerEdits({
    db,
    tenantId: tenant,
    client,
    more: () => true,
    sent: ids.map((id) => message(id, opts.sent?.[id])),
    sentComplete: opts.sentComplete ?? true,
    own
  })
  return { out, calls, asked }
}

describe('the owner’s edits of GROS’s sent emails (PIC-29 part 2b)', () => {
  it('learns what the owner took out, reading only the workspace’s drafted builds', async () => {
    const { out, calls } = await read(['MsgA', 'MsgB'])
    expect(out).toMatchObject({ tried: 2, edits: 2, left: 0, stopped: null })
    expect(out.learned?.never).toEqual([
      { phrase: 'truly amazing', removed: 2, kept: 0, instead: [] }
    ])
    expect(out.learned?.watched).toEqual([])
    expect(calls.filter(([, n]) => n === 'eq')).toEqual([
      ['klaviyo_draft_pushes', 'eq', ['tenant_id', tenant]],
      ['email_builds', 'eq', ['tenant_id', tenant]],
      ['email_builds', 'eq', ['state', 'drafted']]
    ])
  })

  it('learns only from the AI’s words: plain words, tests and old builds are left out', async () => {
    const plain = await read(['MsgA'], {
      builds: [buildRow('MsgA', build({ copy: 'plain', ai: false }))]
    })
    expect(plain.out).toEqual({
      learned: null,
      tried: 0,
      edits: 0,
      left: 1,
      stopped: null
    })
    expect(plain.asked).toEqual([])
    const tests = await read(['MsgA', 'MsgB', 'MsgC', 'MsgD'], {
      sent: { MsgC: { abTest: true } },
      builds: [
        buildRow('MsgA', build({ designA: '<p>A</p>' })),
        buildRow('MsgB', build({ subjectB: 'Our story' })),
        buildRow('MsgC', build()),
        buildRow('MsgD', build())
      ]
    })
    expect(tests.out).toMatchObject({ tried: 1, left: 3, stopped: null })
    expect(tests.asked).toEqual(['TplMsgD'])
    // The newest drafted build no longer reads: never an older one instead.
    const old = await read(['MsgA'], {
      builds: [
        buildRow('MsgA', { subject: 'x' }, '2026-10-10T10:00:00Z'),
        buildRow('MsgA', build(), '2026-10-01T10:00:00Z')
      ]
    })
    expect(old.out).toMatchObject({ learned: null, tried: 0, left: 1 })
  })

  it('keeps the list as it was when the read is cut short', async () => {
    // The sent list was cut short, an email's content is not known, every
    // template is gone, or one could not be read.
    const cut = await read(['MsgA'], { sentComplete: false })
    expect(cut.out).toMatchObject({ learned: null, stopped: 'incomplete' })
    const unknown = await read(['MsgA', 'MsgB'], {
      sent: { MsgB: { contentKnown: false } }
    })
    expect(unknown.out).toMatchObject({
      learned: null,
      tried: 1,
      stopped: 'incomplete'
    })
    const noTemplate = await read(['MsgA'], {
      sent: { MsgA: { templateId: null } }
    })
    expect(noTemplate.out).toMatchObject({
      learned: null,
      stopped: 'incomplete'
    })
    const gone = await read(['MsgA', 'MsgB'], { answers: {} })
    expect(gone.out).toMatchObject({ learned: null, stopped: 'incomplete' })
    const odd = await read(['MsgA'], { answers: { TplMsgA: { data: null } } })
    expect(odd.out).toMatchObject({ learned: null, stopped: 'incomplete' })
    // Every template changed after its send: not what went out.
    const changed = await read(['MsgA', 'MsgB'], {
      answers: {
        TplMsgA: template(
          'TplMsgA',
          letter('', 'MsgA'),
          '2026-10-11T10:00:05Z'
        ),
        TplMsgB: template('TplMsgB', letter('', 'MsgB'), '2026-10-11T10:00:05Z')
      }
    })
    expect(changed.out).toMatchObject({ learned: null, stopped: 'incomplete' })
    // No sent GROS email: nothing to learn, the list stays.
    const none = await read([])
    expect(none.out).toEqual({
      learned: null,
      tried: 0,
      edits: 0,
      left: 0,
      stopped: null
    })
  })

  it('stops on a bad key, a rate limit or a missing scope, never throws for Klaviyo', async () => {
    const fail = (kind: 'bad_key' | 'rate_limited' | 'missing_scope') =>
      read(['MsgA'], {
        answers: {
          TplMsgA: new KlaviyoError(kind, { endpoint: '/api/templates/' })
        }
      })
    expect((await fail('bad_key')).out).toMatchObject({
      learned: null,
      stopped: 'bad_key'
    })
    expect((await fail('rate_limited')).out).toMatchObject({
      learned: null,
      stopped: 'rate_limited'
    })
    expect((await fail('missing_scope')).out).toMatchObject({
      learned: null,
      stopped: 'missing_scope'
    })
  })
})

describe('an edit, side by side', () => {
  const body = (
    id: string,
    html: string,
    updated: string | null = null
  ): MessageBody => ({
    messageId: id,
    templateId: `Tpl${id}`,
    editor: 'code',
    html,
    text: null,
    updated,
    truncated: false
  })
  const built = (b = build()) => new Map([['MsgA', b as unknown as SentBuild]])

  it('reads the subject and the preview line without names or contact details', () => {
    const [edit] = ownerEditsOf({
      sent: [
        message('MsgA', {
          subject: 'A note from Maya Patel',
          preview: 'Reply to maya@cedarshop.example with any question.'
        })
      ],
      built: built(
        build({ preheader: 'Reply to this email with any question.' })
      ),
      bodies: [body('MsgA', letter(''))],
      own
    })
    expect(edit!.sent.slice(0, 2)).toEqual([
      'A note from [name]',
      'Reply to [email] with any question.'
    ])
    expect(edit!.drafted.slice(0, 2)).toEqual([
      'A note from our founder',
      'Reply to this email with any question.'
    ])
    expect(edit!.sent.slice(0, 2).join(' ')).not.toMatch(/maya|patel/i)
  })

  it('leaves out a template changed after its send', () => {
    expect(
      ownerEditsOf({
        sent: [message('MsgA')],
        built: built(),
        bodies: [body('MsgA', letter(''), '2026-10-12T10:00:00Z')],
        own
      })
    ).toEqual([])
    expect(
      ownerEditsOf({
        sent: [message('MsgA')],
        built: built(),
        bodies: [body('MsgA', letter(''), '2026-10-10T10:00:00Z')],
        own
      })
    ).toHaveLength(1)
  })

  it('never keeps what may be a person’s name, nor what the owner wrote instead', () => {
    const word = (phrase: string) => ({
      phrase,
      removed: 2,
      kept: 0,
      instead: ['Rose']
    })
    const edits = [
      {
        messageId: 'MsgA',
        drafted: [
          'Loved by Jordan and 300 others. Truly warm.',
          'Meet Olivia today'
        ],
        sent: ['Loved by 300 others.']
      }
    ]
    expect(
      withoutNames(
        {
          never: [word('jordan'), word('truly warm')],
          watched: [word('olivia'), word('loved')]
        },
        edits
      )
    ).toEqual({
      never: [{ phrase: 'truly warm', removed: 2, kept: 0, instead: [] }],
      watched: [{ phrase: 'loved', removed: 2, kept: 0, instead: [] }]
    })
  })
})

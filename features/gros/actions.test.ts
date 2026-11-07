import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const nav = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`)
  })
}))
vi.mock('next/navigation', () => nav)
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)

import {
  decideProposal,
  deleteChat,
  proposeChange,
  refreshData,
  renameChat,
  sendMessage,
  setVisibility,
  startChat
} from './actions'

const tenant = '00000000-0000-4000-8000-000000000101'
const chat = '00000000-0000-4000-8000-000000000901'
const campaign = '00000000-0000-4000-8000-000000000601'
const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [k, v] of Object.entries(values)) data.set(k, v)
  return data
}
let rpc: ReturnType<typeof vi.fn>
const as = (tenantRole: string) =>
  auth.requireRequestContext.mockResolvedValue({
    tenantId: tenant,
    tenantRole,
    userId: 'u1'
  })
const refuse = (code: string, message = '') =>
  rpc.mockResolvedValueOnce({ data: null, error: { code, message } })

beforeEach(() => {
  as('owner')
  rpc = vi.fn(async (name: string) => ({
    data: name === 'start_conversation' ? chat : true,
    error: null
  }))
  supabase.createClient.mockResolvedValue({ rpc })
})
afterEach(() => vi.clearAllMocks())

describe('startChat', () => {
  it('saves the chat with its first question and opens it', async () => {
    await expect(
      startChat({}, form({ question: '  How did my last email do?  ' }))
    ).rejects.toThrow(`REDIRECT /gros/${chat}`)
    expect(rpc).toHaveBeenCalledWith('start_conversation', {
      t: tenant,
      question: 'How did my last email do?',
      campaign: undefined,
      visibility: 'private'
    })
  })

  it('saves nothing for an empty question, and says so when GROS refuses', async () => {
    expect(await startChat({}, form({ question: '   ' }))).toEqual({
      error: 'Type a question first.'
    })
    expect(rpc).not.toHaveBeenCalled()
    refuse(
      '23514',
      'Fixture AI budget exhausted; approved delivery remains available'
    )
    expect((await startChat({}, form({ question: 'Hi' }))).error).toBe(
      'Your AI credits for GROS are used up for now. Nothing was saved.'
    )
    expect(nav.redirect).not.toHaveBeenCalled()
  })
})

describe('sendMessage', () => {
  it('asks about the whole workspace when no campaign is chosen', async () => {
    expect(
      await sendMessage({}, form({ chat, question: 'And now?', campaign: '' }))
    ).toEqual({ message: 'Sent.' })
    expect(rpc).toHaveBeenCalledWith('ask_fixture_gros', {
      t: tenant,
      chat,
      campaign: null,
      question: 'And now?',
      intent: 'explain',
      value: ''
    })
  })

  it('explains a deleted chat, a chat that is not yours and a bad form', async () => {
    refuse('PT409', 'This chat was deleted. Start a new one.')
    expect((await sendMessage({}, form({ chat, question: 'Hi' }))).error).toBe(
      'This chat was deleted. Start a new one.'
    )
    refuse('42501', 'Conversation unavailable')
    expect((await sendMessage({}, form({ chat, question: 'Hi' }))).error).toBe(
      'You can’t open or change this chat.'
    )
    expect(
      (await sendMessage({}, form({ chat: 'nope', question: 'Hi' }))).error
    ).toBe('Type a question first.')
  })
})

describe('proposeChange and decideProposal', () => {
  it('proposes a goal change; nothing is applied yet', async () => {
    const result = await proposeChange(
      {},
      form({
        chat,
        campaign,
        intent: 'edit_goal',
        question: 'Clearer goal',
        value: 'Sell more boots'
      })
    )
    expect(result.message).toMatch(/Nothing changes until you apply it/)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith(
      'ask_fixture_gros',
      expect.objectContaining({ intent: 'edit_goal' })
    )
  })

  it('keeps scheduling, cancelling and designers for the owner', async () => {
    as('staff')
    for (const intent of ['schedule', 'cancel', 'request_assignment'])
      expect(
        (
          await proposeChange(
            {},
            form({ chat, campaign, intent, question: 'Please' })
          )
        ).error
      ).toBe('Only the workspace owner can ask for this change.')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('needs the new goal or a real reference', async () => {
    expect(
      (
        await proposeChange(
          {},
          form({ chat, campaign, intent: 'edit_goal', question: 'x' })
        )
      ).error
    ).toBe('Type the new goal.')
    expect(
      (
        await proposeChange(
          {},
          form({
            chat,
            campaign,
            intent: 'select_reference',
            question: 'x',
            value: 'abc'
          })
        )
      ).error
    ).toBe('Choose a reference email.')
  })

  it('only the person who asked applies a change', async () => {
    const decide = form({
      chat,
      proposal: campaign,
      hash: 'a'.repeat(64),
      decision: 'confirmed'
    })
    expect(await decideProposal({}, decide)).toEqual({
      message: 'Applied to the campaign.'
    })
    refuse('42501')
    expect((await decideProposal({}, decide)).error).toBe(
      'Only the person who asked for this change can apply or dismiss it.'
    )
    refuse('PT409', 'Proposal expired')
    expect((await decideProposal({}, decide)).error).toBe('Proposal expired')
  })
})

describe('rename, share, delete and refresh', () => {
  it('renames, and says nothing when the name did not change', async () => {
    expect(await renameChat({}, form({ chat, title: ' Last email ' }))).toEqual(
      { message: 'Renamed.' }
    )
    expect(rpc).toHaveBeenCalledWith('rename_conversation', {
      t: tenant,
      chat,
      title: 'Last email'
    })
    rpc.mockResolvedValueOnce({ data: false, error: null })
    expect(await renameChat({}, form({ chat, title: 'Last email' }))).toEqual(
      {}
    )
    expect((await renameChat({}, form({ chat, title: '' }))).error).toBe(
      'A chat name needs 1 to 200 characters.'
    )
    refuse('42501', 'Only the person who started this chat can rename it')
    expect((await renameChat({}, form({ chat, title: 'Mine' }))).error).toBe(
      'Only the person who started this chat can rename it.'
    )
  })

  it('shares and makes private with plain words about who sees it', async () => {
    expect(
      (await setVisibility({}, form({ chat, visibility: 'shared' }))).message
    ).toBe('Shared. Your workspace team can read this chat now.')
    refuse('42501')
    expect(
      (await setVisibility({}, form({ chat, visibility: 'private' }))).error
    ).toBe('Only the person who started this chat can change who sees it.')
  })

  it('deletes and goes back to Ask GROS', async () => {
    await expect(deleteChat({}, form({ chat }))).rejects.toThrow(
      'REDIRECT /gros'
    )
    expect(rpc).toHaveBeenCalledWith('delete_conversation', { t: tenant, chat })
    refuse('PT409', 'This chat was already deleted.')
    expect((await deleteChat({}, form({ chat }))).error).toBe(
      'This chat was already deleted.'
    )
  })

  it('refresh says honestly that there is nothing new to pull', async () => {
    expect((await refreshData({}, form({ chat }))).message).toMatch(
      /sample connections here/
    )
    expect(rpc).not.toHaveBeenCalled()
  })
})

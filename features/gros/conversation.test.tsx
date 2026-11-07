import {
  cleanup,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { installDialogPolyfill } from '@/tests/helpers/dialog-polyfill'

const actions = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  startChat: vi.fn(),
  renameChat: vi.fn(),
  setVisibility: vi.fn(),
  deleteChat: vi.fn(),
  refreshData: vi.fn(),
  proposeChange: vi.fn(),
  decideProposal: vi.fn()
}))
vi.mock('./actions', () => actions)

import { Conversation } from './conversation'
import { greeting } from './model'
import { ThreadHeader } from './thread-header'

beforeAll(installDialogPolyfill)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const chat = '00000000-0000-4000-8000-000000000901'
const messages = [
  {
    id: 'm1',
    role: 'user' as const,
    body: 'How did my last email do?',
    index: 1,
    at: '2026-11-06T10:00:00Z'
  },
  {
    id: 'm2',
    role: 'assistant' as const,
    body: 'Here is your workspace today.\n\n- **Last sent:** nothing has been sent yet.',
    index: 2,
    at: '2026-11-06T10:00:01Z'
  }
]
const view = (over: Partial<Parameters<typeof Conversation>[0]> = {}) =>
  render(
    <Conversation
      chat={chat}
      greeting={greeting('Demo')}
      messages={messages}
      earlierBefore={null}
      paged={false}
      campaigns={[
        { id: '00000000-0000-4000-8000-000000000601', title: 'Spring launch' }
      ]}
      {...over}
    />
  )

describe('Conversation', () => {
  it('starts with the greeting, then the messages, with GROS replies in Markdown', () => {
    view()
    const items = within(
      screen.getByRole('list', { name: 'Messages' })
    ).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent(/Hi Demo — I'm GROS/)
    expect(items[1]).toHaveTextContent('How did my last email do?')
    expect(within(items[2]!).getByText('Last sent:').tagName).toBe('STRONG')
  })

  it('Enter adds a line; ⌘/Ctrl+Enter sends and clears the box', async () => {
    let finish: (v: unknown) => void = () => {}
    actions.sendMessage.mockImplementation(
      () => new Promise((r) => (finish = r))
    )
    view()
    const box = screen.getByLabelText('Message GROS')
    await userEvent.type(box, 'First line{Enter}second line')
    expect(box).toHaveValue('First line\nsecond line')
    expect(actions.sendMessage).not.toHaveBeenCalled()
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => expect(actions.sendMessage).toHaveBeenCalledTimes(1))
    const data = actions.sendMessage.mock.calls[0]![1] as FormData
    expect(data.get('question')).toBe('First line\nsecond line')
    expect(data.get('chat')).toBe(chat)
    expect(data.get('campaign')).toBe('')
    // The question shows at once, with GROS typing.
    expect(screen.getByText('GROS is typing')).toBeInTheDocument()
    finish({ message: 'Sent.' })
    await waitFor(() => expect(box).toHaveValue(''))
  })

  it('keeps the text and says why when sending fails', async () => {
    actions.sendMessage.mockResolvedValue({
      error: 'This chat was deleted. Start a new one.'
    })
    view()
    const box = screen.getByLabelText('Message GROS')
    await userEvent.type(box, 'Still there?')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This chat was deleted. Start a new one.'
    )
    expect(box).toHaveValue('Still there?')
    expect(box).toHaveFocus()
    expect(screen.queryByText('Still there?', { selector: 'li *' })).toBeNull()
  })

  it('a new chat offers starter questions and sends through startChat', async () => {
    actions.startChat.mockResolvedValue({})
    view({ chat: null, messages: [] })
    const starters = screen.getByRole('group', { name: 'Suggested questions' })
    await userEvent.click(
      within(starters).getByRole('button', {
        name: 'Plan 4 emails for Black Friday'
      })
    )
    expect(screen.getByLabelText('Message GROS')).toHaveValue(
      'Plan 4 emails for Black Friday'
    )
    await userEvent.selectOptions(
      screen.getByLabelText('About'),
      'Spring launch'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(actions.startChat).toHaveBeenCalledTimes(1))
    const data = actions.startChat.mock.calls[0]![1] as FormData
    expect(data.get('chat')).toBeNull()
    expect(data.get('campaign')).toBe('00000000-0000-4000-8000-000000000601')
  })

  it('pages: no greeting on an older page, and links both ways', () => {
    view({ earlierBefore: 51, paged: true })
    expect(screen.queryByText(/Hi Demo/)).toBeNull()
    expect(
      screen.getByRole('link', { name: 'Earlier messages' })
    ).toHaveAttribute('href', `/gros/${chat}?before=51`)
    expect(
      screen.getByRole('link', { name: 'Latest messages' })
    ).toHaveAttribute('href', `/gros/${chat}`)
  })
})

describe('ThreadHeader', () => {
  it('renames on Enter, and Escape puts the name back without saving', async () => {
    actions.renameChat.mockResolvedValue({ message: 'Renamed.' })
    render(
      <ThreadHeader chat={chat} title="Old name" visibility="private" mine />
    )
    const name = screen.getByLabelText('Chat name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Typo{Escape}')
    await waitFor(() => expect(name).toHaveValue('Old name'))
    expect(actions.renameChat).not.toHaveBeenCalled()
    await userEvent.clear(name)
    await userEvent.type(name, 'Spring results{Enter}')
    await waitFor(() => expect(actions.renameChat).toHaveBeenCalledTimes(1))
    expect(
      (actions.renameChat.mock.calls[0]![1] as FormData).get('title')
    ).toBe('Spring results')
    expect(await screen.findByText('Renamed.')).toBeVisible()
  })

  it('explains who will see a shared chat before sharing, and asks before deleting', async () => {
    actions.setVisibility.mockResolvedValue({
      message: 'Shared. Your workspace team can read this chat now.'
    })
    render(<ThreadHeader chat={chat} title="Plans" visibility="private" mine />)
    expect(screen.getByText('PRIVATE')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Make shared' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Share this chat with your team?'
    })
    expect(dialog).toHaveTextContent(/including earlier ones/)
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Make shared' })
    )
    await waitFor(() => expect(actions.setVisibility).toHaveBeenCalledTimes(1))
    expect(
      (actions.setVisibility.mock.calls[0]![1] as FormData).get('visibility')
    ).toBe('shared')
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const ask = await screen.findByRole('alertdialog', {
      name: 'Delete this chat?'
    })
    await userEvent.click(within(ask).getByRole('button', { name: 'Cancel' }))
    expect(actions.deleteChat).not.toHaveBeenCalled()
  })

  it('someone else’s shared chat: the name only, no rename, share or delete', () => {
    render(
      <ThreadHeader
        chat={chat}
        title="Owner's plans"
        visibility="shared"
        mine={false}
      />
    )
    expect(screen.getByRole('heading', { name: "Owner's plans" })).toBeVisible()
    expect(screen.queryByLabelText('Chat name')).toBeNull()
    expect(screen.queryByRole('button', { name: /Make|Delete/ })).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Refresh data' })
    ).toHaveAttribute(
      'title',
      'Force GROS to re-read your latest Klaviyo + Shopify data.'
    )
  })
})

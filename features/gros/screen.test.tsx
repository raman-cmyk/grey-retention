import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./actions', () => ({
  grosAction: vi.fn(async () => ({
    message:
      'Conversation operation persisted. Inspect its exact proposal and campaign state.'
  }))
}))

import AskError from '@/app/(gros)/gros/error'
import AskLoading from '@/app/(gros)/gros/loading'
import type { AskView, ChatProposal, OpenChat } from './read-model'
import { AskScreen } from './screen'

afterEach(cleanup)

const chatA = '00000000-0000-4000-8000-00000000000a'
const chatB = '00000000-0000-4000-8000-00000000000b'

const proposal = (over: Partial<ChatProposal> = {}): ChatProposal => ({
  id: 'p1',
  title: 'Goal change',
  status: 'pending',
  state: 'Waiting for you',
  consequence: 'The goal of Winter sale changes.',
  payload: '{\n  "goal": "Bring back past buyers"\n}',
  ends: 'Nov 24, 2026 · 10:10 AM',
  hash: 'a'.repeat(64),
  canDecide: true,
  ...over
})
const open = (over: Partial<OpenChat> = {}): OpenChat => ({
  id: chatA,
  title: 'Winter questions',
  shared: false,
  mine: true,
  messages: [
    { id: 'm1', fromGros: false, byYou: true, body: 'Where is Winter sale?' },
    { id: 'm2', fromGros: true, byYou: false, body: 'Next step: design.' }
  ],
  earlier: null,
  paged: false,
  proposals: [],
  ...over
})
const ready = (
  over: Partial<Extract<AskView, { kind: 'ready' }>> = {}
): AskView => ({
  kind: 'ready',
  owner: true,
  chats: [
    { id: chatA, title: 'Winter questions', shared: false, mine: true },
    { id: chatB, title: 'Team plan', shared: true, mine: false }
  ],
  open: open(),
  missing: false,
  campaigns: [{ id: 'c1', title: 'Winter sale' }],
  references: [{ id: 'ref-1', subject: 'Rival winter sale' }],
  ...over
})

describe('Ask GROS (UI-ASK)', () => {
  it('is the Ask page of the bar, with past chats beside the open one', () => {
    const { container } = render(<AskScreen view={ready()} />)
    expect(container.firstElementChild).toHaveClass('gros')
    expect(
      screen.getByRole('heading', { level: 1, name: 'Ask GROS' })
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ask GROS' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    const chats = within(
      screen.getByRole('navigation', { name: 'Conversations' })
    ).getAllByRole('link')
    expect(chats.map((c) => c.getAttribute('href'))).toEqual([
      `/gros?chat=${chatA}`,
      `/gros?chat=${chatB}`
    ])
    expect(chats[0]).toHaveAttribute('aria-current', 'page')
    expect(chats[0]).toHaveTextContent('Private · Started by you')
    expect(chats[1]).not.toHaveAttribute('aria-current')
    expect(chats[1]).toHaveTextContent('Shared · Started by a teammate')
    // The open chat, oldest message first, with who wrote each.
    const chat = screen.getByRole('region', { name: 'Winter questions' })
    const messages = within(chat)
      .getByRole('list', { name: 'Messages' })
      .querySelectorAll('li')
    expect([...messages].map((m) => m.textContent)).toEqual([
      'YouWhere is Winter sale?',
      'GROSNext step: design.'
    ])
  })

  it('has one main button per card: Start chat, Send', () => {
    render(<AskScreen view={ready()} />)
    const chats = screen.getByRole('region', { name: 'Chats' })
    expect(within(chats).getByLabelText('Chat name')).toBeRequired()
    expect(within(chats).getByLabelText('Who can see it')).toHaveDisplayValue(
      'Only me'
    )
    expect(
      within(chats).getByRole('button', { name: 'Start chat' })
    ).toBeInTheDocument()
    const chat = screen.getByRole('region', { name: 'Winter questions' })
    expect(
      within(chat)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['Share chat', 'Send'])
  })

  it('lets the composer ask for a goal change or a reference, and owners for more', async () => {
    const user = userEvent.setup()
    render(<AskScreen view={ready()} />)
    const request = screen.getByLabelText('Request')
    expect(
      within(request)
        .getAllByRole('option')
        .map((o) => o.getAttribute('value'))
    ).toEqual([
      'explain',
      'edit_goal',
      'select_reference',
      'schedule',
      'cancel',
      'request_assignment'
    ])
    expect(screen.getByLabelText('Campaign')).toBeRequired()
    expect(screen.getByLabelText('Your question')).toBeRequired()
    expect(screen.queryByLabelText('New goal')).toBeNull()
    await user.selectOptions(request, 'edit_goal')
    expect(screen.getByLabelText('New goal')).toBeRequired()
    await user.selectOptions(request, 'select_reference')
    expect(screen.queryByLabelText('New goal')).toBeNull()
    expect(
      within(screen.getByLabelText('Reference')).getByRole('option', {
        name: 'Rival winter sale'
      })
    ).toHaveValue('ref-1')
  })

  it('offers staff only questions and goal changes, and no reference without one', () => {
    render(<AskScreen view={ready({ owner: false, references: [] })} />)
    expect(
      within(screen.getByLabelText('Request'))
        .getAllByRole('option')
        .map((o) => o.getAttribute('value'))
    ).toEqual(['explain', 'edit_goal'])
  })

  it('pages older messages and back to the latest', () => {
    const { rerender } = render(
      <AskScreen view={ready({ open: open({ earlier: 51 }) })} />
    )
    expect(
      screen.getByRole('link', { name: 'Show earlier messages' })
    ).toHaveAttribute('href', `/gros?chat=${chatA}&before=51`)
    expect(
      screen.queryByRole('link', { name: 'Show latest messages' })
    ).toBeNull()
    rerender(
      <AskScreen view={ready({ open: open({ messages: [], paged: true }) })} />
    )
    expect(
      screen.getByRole('heading', { name: 'No earlier messages' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Show latest messages' })
    ).toHaveAttribute('href', `/gros?chat=${chatA}`)
  })

  it('shows each proposal’s exact change; only the asker confirms or rejects', () => {
    render(
      <AskScreen
        view={ready({
          open: open({
            proposals: [
              proposal(),
              proposal({ id: 'p2', canDecide: true, title: 'Reference' }),
              proposal({
                id: 'p3',
                canDecide: false,
                state: 'Waiting for the person who asked'
              }),
              proposal({
                id: 'p4',
                status: 'confirmed',
                state: 'Confirmed',
                ends: null,
                canDecide: false
              })
            ]
          })
        })}
      />
    )
    const items = within(
      screen.getByRole('list', { name: 'Proposals' })
    ).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent(
      'Waiting for you · Ends Nov 24, 2026 · 10:10 AM'
    )
    expect(items[0]).toHaveTextContent('Needs you')
    expect(items[0]!.querySelector('pre')).toHaveTextContent(
      '"goal": "Bring back past buyers"'
    )
    expect(
      within(items[0]!).getByRole('button', {
        name: 'Confirm change: Goal change'
      })
    ).toHaveClass('bg-[var(--forest)]')
    // One main button: the next ones are outline.
    expect(
      within(items[1]!).getByRole('button', {
        name: 'Confirm change: Reference'
      })
    ).not.toHaveClass('bg-[var(--forest)]')
    expect(
      within(items[0]!).getByRole('button', {
        name: 'Reject change: Goal change'
      })
    ).toBeInTheDocument()
    expect(within(items[2]!).queryAllByRole('button')).toHaveLength(0)
    expect(items[2]).toHaveTextContent('Waiting for the person who asked')
    expect(items[3]).toHaveTextContent('Confirmed')
    expect(items[3]).not.toHaveTextContent('Ends')
  })

  it('lets only the starter of a chat change who sees it', () => {
    const { rerender } = render(
      <AskScreen view={ready({ open: open({ shared: true }) })} />
    )
    expect(
      screen.getByRole('button', { name: 'Make private' })
    ).toBeInTheDocument()
    rerender(
      <AskScreen view={ready({ open: open({ shared: true, mine: false }) })} />
    )
    expect(screen.queryByRole('button', { name: 'Make private' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Share chat' })).toBeNull()
  })

  it('sends to the plan when there is no campaign to ask about', () => {
    render(<AskScreen view={ready({ campaigns: [] })} />)
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    expect(
      screen.getByRole('link', { name: 'Open your plan' })
    ).toHaveAttribute('href', '/plan')
  })

  it('is empty with one button when there are no chats', () => {
    render(<AskScreen view={ready({ chats: [], open: null })} />)
    expect(
      screen.getByRole('heading', { name: 'No chats yet' })
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Start a chat'
    ])
  })

  it('says a chat is not available and leads back to the chats', () => {
    render(<AskScreen view={ready({ open: null, missing: true })} />)
    expect(
      screen.getByRole('heading', { name: 'Chat not available' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Show your chats' })
    ).toHaveAttribute('href', '/gros')
    expect(
      screen.getByRole('navigation', { name: 'Conversations' })
    ).toBeInTheDocument()
  })

  it('says when the chats could not be read, and shows the brand check', () => {
    const { rerender } = render(
      <AskScreen view={{ kind: 'unread', reason: 'They are safe.' }} />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Chats did not openThey are safe.'
    )
    rerender(
      <AskScreen
        view={ready()}
        brandNote={<aside role="note" aria-label="Brand check" />}
      />
    )
    expect(
      screen.getByRole('note', { name: 'Brand check' })
    ).toBeInTheDocument()
  })

  it('opens and fails with the bar and Ask current', async () => {
    const { container, unmount } = render(<AskLoading />)
    expect(screen.getByText('Opening your chats')).toBeInTheDocument()
    expect(container.querySelector('main')).toBeNull()
    expect(screen.getByRole('link', { name: 'Ask GROS' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    unmount()
    const retry = vi.fn()
    render(<AskError retry={retry} />)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalled()
  })
})

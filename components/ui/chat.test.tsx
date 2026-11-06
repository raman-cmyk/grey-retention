import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ChatComposer,
  ChatThread,
  QuickReplies,
  type ChatMessage
} from './chat'

afterEach(cleanup)

const messages: ChatMessage[] = [
  { id: '1', role: 'assistant', text: 'What do you wanna send on this day?' },
  { id: '2', role: 'user', text: 'A <b>spring</b> sale' }
]

describe('chat UI', () => {
  it('puts the owner on the right and the assistant on the left, as plain text', () => {
    render(
      <ChatThread
        label="Plan send chat"
        assistantName="GROS"
        messages={messages}
      />
    )
    const log = screen.getByRole('log', { name: 'Plan send chat' })
    const [first, second] = Array.from(log.children) as HTMLElement[]
    expect(first.className).toContain('self-start')
    expect(second.className).toContain('self-end')
    expect(second).toHaveTextContent('You said: A <b>spring</b> sale')
    expect(log.querySelector('b')).toBeNull()
    expect(first).toHaveTextContent('GROS')
    expect(second).toHaveTextContent('You')
  })

  it('can hide captions and shows a typing indicator', () => {
    render(
      <ChatThread
        label="Chat"
        assistantName="GROS"
        messages={messages}
        captions={false}
        typing
      />
    )
    expect(screen.getByText('GROS is typing')).toBeInTheDocument()
    expect(screen.queryByText('You', { exact: true })).not.toBeInTheDocument()
  })

  it('scrolls to the newest message', () => {
    const { rerender } = render(
      <ChatThread label="Chat" assistantName="GROS" messages={messages} />
    )
    const log = screen.getByRole('log')
    Object.defineProperty(log, 'scrollHeight', {
      configurable: true,
      value: 900
    })
    rerender(
      <ChatThread
        label="Chat"
        assistantName="GROS"
        messages={[...messages, { id: '3', role: 'assistant', text: 'Great.' }]}
      />
    )
    expect(log.scrollTop).toBe(900)
  })

  it('sends trimmed text on Enter, keeps Shift+Enter for new lines, and never sends blanks', async () => {
    const onSend = vi.fn()
    render(<ChatComposer label="Message GROS" onSend={onSend} />)
    const box = screen.getByLabelText('Message GROS')
    const send = screen.getByRole('button', { name: 'Send message' })
    expect(send).toBeDisabled()
    await userEvent.type(box, '   {Enter}')
    expect(onSend).not.toHaveBeenCalled()
    await userEvent.clear(box)
    await userEvent.type(box, 'Line one{Shift>}{Enter}{/Shift}line two{Enter}')
    expect(onSend).toHaveBeenCalledExactlyOnceWith('Line one\nline two')
    expect(box).toHaveValue('')
  })

  it('does not send while busy and offers attach only when wired', async () => {
    const onSend = vi.fn()
    const { rerender } = render(
      <ChatComposer label="Message" onSend={onSend} disabled />
    )
    await userEvent.type(screen.getByLabelText('Message'), 'Hello{Enter}')
    expect(onSend).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('button', { name: 'Attach a file' })
    ).not.toBeInTheDocument()
    const onAttach = vi.fn()
    rerender(
      <ChatComposer label="Message" onSend={onSend} onAttach={onAttach} />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Attach a file' }))
    expect(onAttach).toHaveBeenCalledOnce()
  })

  it('offers quick replies as buttons', async () => {
    const onPick = vi.fn()
    render(
      <QuickReplies replies={['Yes', 'Change the date']} onPick={onPick} />
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Change the date' })
    )
    expect(onPick).toHaveBeenCalledWith('Change the date')
    cleanup()
    const { container } = render(<QuickReplies replies={[]} onPick={onPick} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('never sends on the Enter that finishes an IME word', () => {
    const onSend = vi.fn()
    render(<ChatComposer label="Message" onSend={onSend} />)
    const box = screen.getByLabelText('Message')
    fireEvent.change(box, { target: { value: '春のセール' } })
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledExactlyOnceWith('春のセール')
  })

  it('keeps the text when sending fails, and never sends twice', async () => {
    let finish: (ok: boolean) => void = () => undefined
    const onSend = vi.fn(
      () => new Promise<boolean>((resolve) => (finish = resolve))
    )
    render(<ChatComposer label="Message" onSend={onSend} />)
    const box = screen.getByLabelText('Message')
    await userEvent.type(box, 'Hello{Enter}')
    await userEvent.keyboard('{Enter}')
    expect(onSend).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
    await act(async () => finish(false))
    expect(box).toHaveValue('Hello')
    await userEvent.keyboard('{Enter}')
    await act(async () => finish(true))
    expect(box).toHaveValue('')
  })

  it('stops following new messages while the owner reads older ones', () => {
    const { rerender } = render(
      <ChatThread label="Chat" assistantName="GROS" messages={messages} />
    )
    const log = screen.getByRole('log')
    Object.defineProperty(log, 'scrollHeight', {
      configurable: true,
      value: 900
    })
    Object.defineProperty(log, 'clientHeight', {
      configurable: true,
      value: 300
    })
    log.scrollTop = 100
    fireEvent.scroll(log)
    rerender(
      <ChatThread
        label="Chat"
        assistantName="GROS"
        messages={[...messages, { id: '9', role: 'assistant', text: 'New.' }]}
      />
    )
    expect(log.scrollTop).toBe(100)
  })
})

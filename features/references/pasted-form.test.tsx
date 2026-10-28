import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PastedReferenceForm } from './pasted-form'
import { PastedText } from './pasted-text'
import { pastedLimits } from './pasted'
const { importPastedReference } = vi.hoisted(() => ({
  importPastedReference: vi.fn()
}))
vi.mock('./pasted-actions', () => ({ importPastedReference }))
afterEach(cleanup)
const requestKey = crypto.randomUUID()
const hostile =
  '<p>Hello</p><img src="https://tracker.example/o.gif" onerror="alert(1)"><script>alert(2)</script><iframe src="https://evil.example"></iframe><p>&lt;b&gt;literal&lt;/b&gt;</p>'

describe('Pasted reference form', () => {
  it('previews hostile markup as text without creating elements or loading resources', () => {
    const { container } = render(
      <PastedReferenceForm requestKey={requestKey} />
    )
    fireEvent.change(screen.getByLabelText('Email text'), {
      target: { value: hostile }
    })
    const preview = screen.getByRole('region', { name: 'Plain-text preview' })
    expect(preview).toHaveTextContent('Hello')
    expect(preview).toHaveTextContent('<b>literal</b>')
    expect(preview).not.toHaveTextContent('alert')
    expect(
      container.querySelectorAll('img, script, iframe, b, a')
    ).toHaveLength(0)
    expect(screen.getByText(/Code and formatting were removed/)).toBeVisible()
    expect(
      screen.getByText('Where is it from? · optional').closest('details')
    ).not.toHaveAttribute('open')
    expect(
      screen.getAllByRole('button').map((button) => button.textContent)
    ).toEqual(['Save and use this email'])
    expect(screen.queryByText(/Preview limited/)).toBeNull()
  })
  it('says when a long preview is limited and that the full paste will be saved', () => {
    render(<PastedReferenceForm requestKey={requestKey} />)
    const body = `<p>${'Long readable line. '.repeat(1500)}</p>`
    fireEvent.change(screen.getByLabelText('Email text'), {
      target: { value: body }
    })
    expect(
      screen.getByText(/Preview limited to the first 20,000/)
    ).toHaveTextContent('The full email you pasted will be saved unchanged.')
    expect(screen.getByLabelText('Email text')).toHaveValue(body)
  })
  it('labels a reopened saved preview at the limit without claiming the original was cut', () => {
    const { rerender } = render(
      <PastedText text={'z'.repeat(pastedLimits.readable)} />
    )
    expect(screen.getByText(/Preview limited/)).toHaveTextContent(
      'The full email you pasted is saved unchanged.'
    )
    rerender(<PastedText text="A short saved email" />)
    expect(screen.queryByText(/Preview limited/)).toBeNull()
  })
  it('keeps every entered value and the same request key after a failed save', async () => {
    importPastedReference.mockResolvedValue({
      error: 'We could not save this email. Your text is still here; try again.'
    })
    const user = userEvent.setup()
    render(<PastedReferenceForm requestKey={requestKey} />)
    await user.type(screen.getByLabelText('Subject line'), 'Spring note')
    fireEvent.change(screen.getByLabelText('Email text'), {
      target: { value: 'First paragraph\n\nSecond paragraph' }
    })
    await user.click(screen.getByText('Where is it from? · optional'))
    await user.type(
      screen.getByLabelText('Web address'),
      'https://shop.example'
    )
    await user.click(
      screen.getByRole('button', { name: 'Save and use this email' })
    )
    expect(await screen.findByText(/Your text is still here/)).toBeVisible()
    expect(screen.getByLabelText('Subject line')).toHaveValue('Spring note')
    expect(screen.getByLabelText('Email text')).toHaveValue(
      'First paragraph\n\nSecond paragraph'
    )
    expect(screen.getByLabelText('Web address')).toHaveValue(
      'https://shop.example'
    )
    expect(
      screen.getByText('Outline your draft can follow: Opening · Closing')
    ).toBeVisible()
    const sent = importPastedReference.mock.calls.at(-1)![1] as FormData
    expect(sent.get('requestKey')).toBe(requestKey)
    expect(sent.get('body')).toBe('First paragraph\n\nSecond paragraph')
  })
})

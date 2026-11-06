import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Route } from 'next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const back = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ back }) }))
const { cameFromThisApp, HistoryBack } = await import('./history-back')
const fallback = '/flows/F1?from=flows' as Route

function setHistoryLength(length: number) {
  Object.defineProperty(window.history, 'length', {
    configurable: true,
    value: length
  })
}

beforeEach(() => setHistoryLength(2))

afterEach(() => {
  cleanup()
  back.mockReset()
  Object.defineProperty(document, 'referrer', { configurable: true, value: '' })
  Reflect.deleteProperty(window.history, 'length')
})

describe('history back', () => {
  it('knows whether the last page was in this app', () => {
    expect(
      cameFromThisApp('http://localhost:3000/flows/1', 'http://localhost:3000')
    ).toBe(true)
    expect(
      cameFromThisApp('https://other.example/', 'http://localhost:3000')
    ).toBe(false)
    expect(cameFromThisApp('', 'http://localhost:3000')).toBe(false)
    expect(cameFromThisApp('not a url', 'http://localhost:3000')).toBe(false)
  })

  it('goes back only when the owner came from inside the app', () => {
    render(<HistoryBack fallback={fallback} />)
    const link = screen.getByRole('link', { name: 'Back' })
    fireEvent.click(link)
    expect(back).not.toHaveBeenCalled()
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      value: `${window.location.origin}/flows/F1`
    })
    fireEvent.click(link)
    expect(back).toHaveBeenCalledOnce()
  })

  it('opens the fallback in a new tab that has an app referrer but no history', () => {
    // Middle-click on "Open this email" makes a tab whose referrer is the
    // flow page, but there is nothing to go back to.
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      value: `${window.location.origin}/flows/F1`
    })
    setHistoryLength(1)
    render(<HistoryBack fallback={fallback} />)
    const link = screen.getByRole('link', { name: 'Back' })
    expect(fireEvent.click(link)).toBe(true)
    expect(back).not.toHaveBeenCalled()
    expect(link).toHaveAttribute('href', fallback)
  })

  it('lets modified clicks open the fallback in a new tab', () => {
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      value: `${window.location.origin}/flows/F1`
    })
    render(<HistoryBack fallback={fallback} />)
    const link = screen.getByRole('link', { name: 'Back' })
    for (const modifier of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { button: 1 }
    ])
      fireEvent.click(link, modifier)
    expect(back).not.toHaveBeenCalled()
  })
})

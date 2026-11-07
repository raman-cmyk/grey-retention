import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Route } from 'next'
import { afterEach, describe, expect, it } from 'vitest'
import { NewMenu } from './new-menu'

const items = [
  {
    label: 'Single send',
    hint: 'One email.',
    href: '#create-campaign' as Route
  },
  {
    label: 'Fill the month with AI',
    hint: 'A plan.',
    href: '#planning' as Route
  }
]

afterEach(cleanup)

describe('the one + New menu', () => {
  it('opens with its choices and closes on Escape, focus back on New', () => {
    render(<NewMenu items={items} />)
    const button = screen.getByRole('button', { name: 'New' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('list', { name: 'Create' })
    expect(button).toHaveAttribute('aria-controls', menu.id)
    expect(screen.getByRole('link', { name: /Single send/ })).toHaveAttribute(
      'href',
      '#create-campaign'
    )
    expect(
      screen.getByRole('link', { name: /Fill the month with AI/ })
    ).toHaveAttribute('href', '#planning')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('list', { name: 'Create' })).toBeNull()
    expect(button).toHaveFocus()
  })

  it('closes on an outside click and after choosing', () => {
    render(
      <>
        <NewMenu items={items} />
        <p>outside</p>
      </>
    )
    const button = screen.getByRole('button', { name: 'New' })
    fireEvent.click(button)
    fireEvent.pointerDown(screen.getByText('outside'))
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('link', { name: /Single send/ }))
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes when focus leaves the menu', () => {
    render(
      <>
        <NewMenu items={items} />
        <button type="button">Elsewhere</button>
      </>
    )
    const button = screen.getByRole('button', { name: 'New' })
    fireEvent.click(button)
    fireEvent.blur(button, {
      relatedTarget: screen.getByRole('button', { name: 'Elsewhere' })
    })
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })
})

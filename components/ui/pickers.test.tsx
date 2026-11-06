import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudiencePicker, type AudienceOption } from './audience-picker'
import type { PickerState } from './picker-parts'
import { ProductPicker, type ProductOption } from './product-picker'

afterEach(cleanup)

const audiences: AudienceOption[] = [
  { id: 'l1', name: 'Newsletter', kind: 'list' },
  { id: 's1', name: 'Engaged 90 days', kind: 'segment' },
  { id: 's2', name: 'VIP buyers', kind: 'segment' }
]

function Audience({
  initial = [] as string[],
  options = audiences,
  state = 'ready' as PickerState,
  sample = false,
  onSubmit = vi.fn()
}) {
  const [value, setValue] = useState(initial)
  return (
    <form
      data-testid="form"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <AudiencePicker
        label="Send to"
        name="include"
        options={options}
        value={value}
        onChange={setValue}
        state={state}
        sample={sample}
      />
      <button type="submit">Save</button>
    </form>
  )
}

const submitted = (name: string) => [
  ...new FormData(screen.getByTestId('form') as HTMLFormElement).getAll(name)
]

describe('AudiencePicker', () => {
  it('counts, tags and submits the chosen lists and segments', async () => {
    render(<Audience />)
    const group = screen.getByRole('group', { name: /Send to/ })
    expect(group).toHaveTextContent('0 selected')
    expect(within(group).getAllByText('Segment')).toHaveLength(2)
    await userEvent.click(screen.getByRole('checkbox', { name: /Newsletter/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /VIP buyers/ }))
    expect(group).toHaveTextContent('2 selected')
    expect(submitted('include')).toEqual(['l1', 's2'])
  })

  it('keeps hidden choices while searching, and Clear empties it', async () => {
    render(<Audience initial={['s2', 'gone']} />)
    expect(submitted('include')).toEqual(['s2'])
    await userEvent.type(screen.getByRole('searchbox'), 'news')
    expect(
      screen.queryByRole('checkbox', { name: /VIP/ })
    ).not.toBeInTheDocument()
    expect(submitted('include')).toEqual(['s2'])
    await userEvent.clear(screen.getByRole('searchbox'))
    await userEvent.type(screen.getByRole('searchbox'), 'zzz')
    expect(screen.getByRole('status')).toHaveTextContent(
      'No lists or segments match “zzz”.'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Clear Send to' }))
    expect(submitted('include')).toEqual([])
    expect(
      screen.queryByRole('button', { name: /Clear/ })
    ).not.toBeInTheDocument()
  })

  it('explains an empty account', () => {
    render(<Audience options={[]} />)
    expect(screen.getByText(/No lists or segments yet/)).toBeInTheDocument()
  })
})

const products: ProductOption[] = [
  { id: 'p1', title: 'Cold brew kit', vendor: 'Northwind' },
  { id: 'p2', title: 'Pour-over set', vendor: null }
]

function Products({
  initial = null as string | null,
  options = products,
  state = 'ready' as PickerState,
  onSubmit = vi.fn()
}) {
  const [value, setValue] = useState(initial)
  return (
    <form
      data-testid="form"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <ProductPicker
        label="Featured product"
        name="product"
        options={options}
        value={value}
        onChange={setValue}
        state={state}
      />
      <button type="submit">Save</button>
    </form>
  )
}

describe('ProductPicker', () => {
  it('starts on "let AI pick" and lists products as “Name” (vendor)', async () => {
    render(<Products />)
    expect(
      screen.getByRole('radio', { name: '— no default (let AI pick) —' })
    ).toBeChecked()
    expect(
      screen.getByRole('radio', { name: '“Cold brew kit” (Northwind)' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: '“Pour-over set”' })
    ).toBeInTheDocument()
    expect(submitted('product')).toEqual([''])
    await userEvent.click(screen.getByRole('radio', { name: /Pour-over/ }))
    expect(submitted('product')).toEqual(['p2'])
  })

  it('searches by name or vendor and keeps a hidden choice', async () => {
    render(<Products initial="p2" />)
    await userEvent.type(screen.getByRole('searchbox'), 'northwind')
    expect(
      screen.queryByRole('radio', { name: /Pour-over/ })
    ).not.toBeInTheDocument()
    expect(screen.getByText(/Chosen: “Pour-over set”/)).toBeInTheDocument()
    expect(submitted('product')).toEqual(['p2'])
    await userEvent.clear(screen.getByRole('searchbox'))
    await userEvent.type(screen.getByRole('searchbox'), 'tea')
    expect(screen.getByRole('status')).toHaveTextContent(
      'No products match “tea”.'
    )
  })

  it('treats an unknown saved product as "let AI pick"', () => {
    render(<Products initial="deleted" />)
    expect(screen.getByRole('radio', { name: /let AI pick/ })).toBeChecked()
    expect(submitted('product')).toEqual([''])
  })

  it('explains an empty catalogue', () => {
    render(<Products options={[]} />)
    expect(screen.getByText(/No products yet/)).toBeInTheDocument()
  })
})

describe('pickers keep saved choices honest', () => {
  it('never submits the form on Enter in a search box', async () => {
    const onSubmit = vi.fn()
    render(<Audience onSubmit={onSubmit} />)
    await userEvent.type(screen.getByRole('searchbox'), 'news{Enter}')
    cleanup()
    render(<Products onSubmit={onSubmit} />)
    await userEvent.type(screen.getByRole('searchbox'), 'kit{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('keeps saved audiences while loading or after an error', () => {
    for (const state of ['loading', 'error'] as const) {
      render(<Audience initial={['s2', 'gone']} options={[]} state={state} />)
      expect(submitted('include')).toEqual(['s2', 'gone'])
      expect(screen.getByText(/Your saved choice is kept/)).toBeInTheDocument()
      expect(screen.queryByText(/Connect Klaviyo/)).not.toBeInTheDocument()
      cleanup()
    }
  })

  it('names saved audiences that vanished and removes duplicates', () => {
    render(<Audience initial={['s2', 's2', 'gone']} sample />)
    expect(
      screen.getByText(/1 saved list or segment is no longer in Klaviyo/)
    ).toBeInTheDocument()
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    expect(submitted('include')).toEqual(['s2'])
    expect(screen.getByText('(sample lists)')).toBeInTheDocument()
  })

  it('moves focus to the search box after Clear', async () => {
    render(<Audience initial={['l1']} />)
    await userEvent.click(screen.getByRole('button', { name: 'Clear Send to' }))
    expect(screen.getByRole('searchbox')).toHaveFocus()
  })

  it('submits the product through the radios, and keeps it while loading', async () => {
    render(<Products />)
    await userEvent.click(screen.getByRole('radio', { name: /Cold brew/ }))
    expect([
      ...new FormData(screen.getByTestId('form') as HTMLFormElement).entries()
    ]).toEqual([['product', 'p1']])
    cleanup()
    render(<Products initial="p2" options={[]} state="loading" />)
    expect(submitted('product')).toEqual(['p2'])
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('says when the saved product vanished', () => {
    render(<Products initial="deleted" />)
    expect(
      screen.getByText(/saved product is no longer in the store/)
    ).toBeInTheDocument()
  })
})

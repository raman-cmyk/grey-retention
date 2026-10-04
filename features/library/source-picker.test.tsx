import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it } from 'vitest'
import { StructurePicker } from './source-picker'

afterEach(cleanup)
const templates = [{ id: 'own', name: 'Own confirmed structure' }],
  references = [{ id: 'reference', subject: 'Subscribed structure' }]

function submitted(container: HTMLElement) {
  return Object.fromEntries(new FormData(container.querySelector('form')!))
}

it('submits the matching source kind and identifier as the user chooses either library', async () => {
  const user = userEvent.setup()
  const { container } = render(
    <form>
      <StructurePicker
        label="Authorized structure"
        templates={templates}
        references={references}
      />
    </form>
  )
  expect(submitted(container)).toEqual({
    source: 'own_template',
    sourceId: 'own'
  })
  await user.selectOptions(
    screen.getByLabelText('Authorized structure'),
    'reference_structure:reference'
  )
  expect(submitted(container)).toEqual({
    source: 'reference_structure',
    sourceId: 'reference'
  })
  await user.selectOptions(
    screen.getByLabelText('Authorized structure'),
    'own_template:own'
  )
  expect(submitted(container)).toEqual({
    source: 'own_template',
    sourceId: 'own'
  })
})

it('preserves an authorized render lineage and clears the identifier when switching to fixture structure', async () => {
  const user = userEvent.setup()
  const { container } = render(
    <form>
      <StructurePicker
        label="Rendering structure"
        templates={templates}
        references={references}
        allowFixture
        defaultSource="reference_structure"
        defaultId="reference"
      />
    </form>
  )
  expect(submitted(container)).toEqual({
    source: 'reference_structure',
    sourceId: 'reference'
  })
  await user.selectOptions(
    screen.getByLabelText('Rendering structure'),
    'fixture_structure:'
  )
  expect(submitted(container)).toEqual({
    source: 'fixture_structure',
    sourceId: ''
  })
})

it('resets a removed or invalid source identifier to a permitted choice', () => {
  const { container, rerender } = render(
    <form>
      <StructurePicker
        label="Rendering structure"
        templates={templates}
        references={references}
        allowFixture
        defaultSource="reference_structure"
        defaultId="reference"
      />
    </form>
  )
  rerender(
    <form>
      <StructurePicker
        label="Rendering structure"
        templates={templates}
        references={[]}
        allowFixture
        defaultSource="reference_structure"
        defaultId="reference"
      />
    </form>
  )
  expect(submitted(container)).toEqual({
    source: 'fixture_structure',
    sourceId: ''
  })
})

it('shows a required empty choice when no authorized source is available', () => {
  const { container } = render(
    <form>
      <StructurePicker
        label="Authorized structure"
        templates={[]}
        references={[]}
      />
    </form>
  )
  expect(screen.getByLabelText('Authorized structure')).toBeInvalid()
  expect(submitted(container)).toEqual({ source: '', sourceId: '' })
})

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import EmailLoading from './plan/email/[buildId]/loading'
import PlanLoading from './plan/loading'
import ResultsLoading from './results/loading'

afterEach(cleanup)

// UI-LOAD-a: a loading state sits beside the streaming page, so it never
// draws a second <main> (the page brings its own).
describe('lane A loading states', () => {
  it.each([
    ['Plan', PlanLoading, 'Opening your plan'],
    ['Results', ResultsLoading, 'Opening Results'],
    ['Email', EmailLoading, 'Opening your email']
  ])(
    '%s opens with its words and the menu, busy, and no main',
    (_, Loading, words) => {
      const { container } = render(<Loading />)
      expect(screen.getByText(words)).toBeInTheDocument()
      expect(
        screen.getByRole('navigation', { name: 'Main' })
      ).toBeInTheDocument()
      expect(container.querySelector('main')).toBeNull()
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    }
  )
})

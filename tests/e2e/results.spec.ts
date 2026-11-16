import { expect, test } from '@playwright/test'
import { newOwner } from './new-owner'

test.describe('Results (UI-RES-b)', () => {
  test('a new store has no results yet, and one button to plan', async ({
    page
  }, info) => {
    await newOwner(page, { prefix: 'results', name: 'Results studio' })
    await page.goto('/results')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Results' })
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Results', exact: true })
    ).toHaveAttribute('aria-current', 'page')
    await expect(
      page.getByRole('heading', { name: 'No results yet' })
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Plan next 15 days' })
    ).toHaveAttribute('href', '/plan')
    // Nothing scrolls sideways.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true)
    if (process.env.RESULTS_SHOT)
      await page.screenshot({
        path: `${process.env.RESULTS_SHOT}/results-${info.project.name}.png`,
        fullPage: true
      })
  })
})

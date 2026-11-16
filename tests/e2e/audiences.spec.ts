import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { newOwner } from './new-owner'

// A key in Klaviyo's format; the fake adapter connects it to sample data.
const sampleKey = () =>
  `pk_${randomBytes(24).toString('base64url').replace(/[-_]/g, 'x').slice(0, 30)}`

test('UI-AUDa Audiences asks a new store to connect Klaviyo, then lists segments and lists, opens one and comes back', async ({
  page
}) => {
  // A fresh workspace: whatever other specs did to the seed owner's
  // Klaviyo, this one starts not connected.
  await newOwner(page, { prefix: 'audiences', name: 'Audiences studio' })
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Audiences', exact: true })
    .click()
  await expect(page).toHaveURL(/\/audiences$/)
  await expect(
    page.getByRole('heading', { name: 'Audiences', level: 1 })
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Connect Klaviyo', level: 2 })
  ).toBeVisible()
  await page.getByRole('link', { name: 'Connect Klaviyo', exact: true }).click()
  await expect(page).toHaveURL(/\/connections$/)
  const card = page.locator('section', {
    has: page.getByRole('heading', { name: 'Klaviyo', exact: true })
  })
  await card.getByLabel('Private API key', { exact: true }).fill(sampleKey())
  await card.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(
    page.getByText(/Klaviyo connected with sample data/)
  ).toBeVisible()

  await page.goto('/audiences')
  await expect(page.getByText(/Sample Klaviyo data/)).toBeVisible()
  const segments = page.getByRole('region', { name: 'Segments' })
  const lists = page.getByRole('region', { name: 'Lists' })
  await expect(segments.getByRole('listitem').first()).toBeVisible()
  await expect(lists.getByRole('listitem').first()).toBeVisible()
  await segments.getByRole('link', { name: 'Open' }).first().click()
  await expect(page).toHaveURL(/\/segments\//)
  await page.getByRole('link', { name: 'Back to Audiences' }).click()
  await expect(page).toHaveURL(/\/audiences$/)
  await lists.getByRole('link', { name: 'Open' }).first().click()
  await expect(page).toHaveURL(/\/lists\//)
  await page.getByRole('link', { name: 'Back to Audiences' }).click()
  await expect(page).toHaveURL(/\/audiences$/)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})

import { expect, test } from '@playwright/test'
import { login } from './accounts'
import { newOwner } from './new-owner'

const noSidewaysScroll = () =>
  document.documentElement.scrollWidth <= innerWidth

test('UI-ONBb a new owner saves the store and comes back to the step that is Now', async ({
  page
}) => {
  await newOwner(page, { prefix: 'setup', name: 'Setup studio' })
  await page.goto('/setup')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your store' })
  ).toBeVisible()
  await expect(page.getByLabel('Store name')).toHaveValue('Setup studio')
  const steps = page.getByRole('list', { name: 'Steps' })
  await expect(steps.getByRole('link')).toHaveCount(0)

  // A wrong website is said next to its field, and nothing is saved.
  await page.getByLabel('Website').fill('not a website')
  await page.getByRole('button', { name: 'Save store' }).click()
  await expect(page.getByLabel('Website')).toHaveAttribute(
    'aria-invalid',
    'true'
  )
  await expect(
    page.getByText('Enter your store’s website, like cedarlane.com.')
  ).toBeVisible()

  await page.getByLabel('Website').fill('https://www.setup-store.example/')
  await page.getByRole('button', { name: 'Save store' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your brand' })
  ).toBeVisible()

  // Coming back opens the step that is Now; a done step opens again.
  await page.reload()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your brand' })
  ).toBeVisible()
  await steps.getByRole('link', { name: /Store/ }).click()
  await expect(page.getByLabel('Website')).toHaveValue('setup-store.example')
  await page.goto('/setup?step=rivals')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your brand' })
  ).toBeVisible()

  await expect(steps.getByRole('link')).toHaveCount(1)
  expect(await page.evaluate(noSidewaysScroll)).toBe(true)
})

test('UI-ONBb staff see where setup is, with no buttons', async ({ page }) => {
  await login(page, 'staff')
  await page.goto('/setup?step=store')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your store' })
  ).toBeVisible()
  await expect(
    page.getByText('Only the workspace owner can change this.')
  ).toBeVisible()
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('main').getByRole('textbox')).toHaveCount(0)
})

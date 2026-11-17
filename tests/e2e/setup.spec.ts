import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { login } from './accounts'
import { newOwner } from './new-owner'

// A made-up key in the private key's format: sample mode checks the format only.
const sampleKey = () =>
  `pk_${randomBytes(24).toString('base64url').replace(/[-_]/g, 'x').slice(0, 30)}`

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

  // UI-ONBc: the readers are queued, and Progress says so in words.
  await expect(
    page.getByRole('heading', { name: 'Reading your store' })
  ).toBeVisible()
  await expect(page.getByText('Reading your website')).toBeVisible()
  await expect(page.getByText('Products')).toBeVisible()
  // How emails should sound and what to avoid (VISION's brand facts) are
  // asked here, optional, and kept.
  await page
    .getByLabel('How should your emails sound? (optional)')
    .fill('Warm and clear')
  await page
    .getByLabel('Anything we should avoid? (optional)')
    .fill('No medical claims')
  await page.getByRole('button', { name: 'Confirm brand' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Connect Klaviyo' })
  ).toBeFocused()
  await expect(steps.getByRole('link')).toHaveCount(2)
  await steps.getByRole('link', { name: /Brand/ }).click()
  await expect(
    page.getByLabel('How should your emails sound? (optional)')
  ).toHaveValue('Warm and clear')
  await expect(
    page.getByLabel('Anything we should avoid? (optional)')
  ).toHaveValue('No medical claims')
  await page.goto('/setup')

  // UI-ONBd: a wrong key is said under its field; the sample key connects.
  await page.getByLabel('Private API key').fill('not a key')
  await page.getByRole('button', { name: 'Connect Klaviyo' }).click()
  await expect(
    page.getByText('That is not a Klaviyo private API key', { exact: false })
  ).toBeVisible()
  await expect(page.getByLabel('Private API key')).toHaveValue('')
  await page.getByLabel('Private API key').fill(sampleKey())
  await page.getByRole('button', { name: 'Connect Klaviyo' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your discount' })
  ).toBeVisible()

  // An optional code stays on the step; the biggest discount ends it.
  await page.getByLabel('Code', { exact: true }).fill('WELCOME10')
  await page.getByLabel('Percent off', { exact: true }).fill('10')
  await page.getByRole('button', { name: 'Add code' }).click()
  await expect(page.getByText('10% off · No end date')).toBeVisible()
  await page.getByLabel('Biggest discount, in percent').fill('20')
  await page.getByRole('button', { name: 'Save discount' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your rivals' })
  ).toBeVisible()
  await expect(steps.getByRole('link')).toHaveCount(4)
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

import { expect, test } from '@playwright/test'
import { login } from './accounts'
import { newOwner } from './new-owner'
import { runReaders } from './readers'

const noSidewaysScroll = () =>
  document.documentElement.scrollWidth <= innerWidth

test('UI-ONBb a new owner saves the store and comes back to the step that is Now', async ({
  page,
  request
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
  // UI-ONBc: the website is read first, so Brand waits and Klaviyo is Now.
  const klaviyo = page.getByRole('heading', {
    level: 1,
    name: 'Connect Klaviyo'
  })
  await expect(klaviyo).toBeVisible()

  // Coming back opens the step that is Now; a done step opens again.
  await page.reload()
  await expect(klaviyo).toBeVisible()
  await steps.getByRole('link', { name: /Store/ }).click()
  await expect(page.getByLabel('Website')).toHaveValue('setup-store.example')
  await page.goto('/setup?step=rivals')
  await expect(klaviyo).toBeVisible()

  // Store, and Brand waiting while the website is read, open again.
  await expect(steps.getByRole('link')).toHaveCount(2)
  expect(await page.evaluate(noSidewaysScroll)).toBe(true)
  await steps.getByRole('link', { name: /Brand.*Reading your website/ }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your brand' })
  ).toBeVisible()

  // The readers are queued, and Progress says so in words.
  const main = page.getByRole('main')
  await expect(
    main.getByRole('heading', { name: 'Reading your store' })
  ).toBeVisible()
  await expect(
    main.getByText('Reading your website', { exact: true })
  ).toBeVisible()
  await expect(main.getByText('Products')).toBeVisible()
  // Confirm brand waits for the website to be read; he can go on meanwhile.
  await expect(
    main.getByText(
      'Reading your website. This can take a few hours. Go on with the next steps; we’ll ask you to confirm your brand when it’s read.'
    )
  ).toBeVisible()
  await expect(
    main.getByRole('link', { name: 'Go on to Klaviyo' })
  ).toHaveAttribute('href', '/setup?step=klaviyo')
  await expect(page.getByRole('button', { name: 'Confirm brand' })).toHaveCount(
    0
  )
  await runReaders(request)
  // Read: Brand is Now again.
  await page.goto('/setup')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your brand' })
  ).toBeVisible()
  // How emails should sound and what to avoid (VISION's brand facts) are
  // asked here, optional, and kept.
  await page
    .getByLabel('How should your emails sound? (optional)')
    .fill('Warm and clear')
  await page
    .getByLabel('Anything we should avoid? (optional)')
    .fill('No medical claims')
  await page.getByRole('button', { name: 'Confirm brand' }).click()
  await expect(klaviyo).toBeFocused()
  await expect(steps.getByRole('link')).toHaveCount(2)
  await steps.getByRole('link', { name: /Brand/ }).click()
  await expect(
    page.getByLabel('How should your emails sound? (optional)')
  ).toHaveValue('Warm and clear')
  await expect(
    page.getByLabel('Anything we should avoid? (optional)')
  ).toHaveValue('No medical claims')
  await page.goto('/setup')
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

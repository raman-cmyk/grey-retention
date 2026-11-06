import { randomBytes } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { login } from './accounts'

// Random sample keys in the right shape; the app checks format only.
const sample = (prefix: string) =>
  `${prefix}${randomBytes(24).toString('base64url').replace(/[-_]/g, 'x').slice(0, 30)}`
const hint = (key: string, keep: number) =>
  `${key.slice(0, keep)}••••••••${key.slice(-4)}`

async function connectKlaviyo(page: Page, key: string) {
  const card = page.locator('section', {
    has: page.getByRole('heading', { name: 'Klaviyo', exact: true })
  })
  const update = card.getByRole('button', { name: 'Update API key' })
  if (await update.isVisible()) await update.click()
  const field = card.getByLabel(/^(New private|Private) API key$/)
  await field.fill(key)
  await card
    .getByRole('button', { name: /^(Connect|Validate & swap key)$/ })
    .click()
  return card
}

test('UIR-013 owner connects sample Klaviyo and Shopify accounts', async ({
  page
}, info) => {
  await login(page, info.project.name.startsWith('mobile') ? 'other' : 'owner')
  await page.goto('/connections')
  await expect(
    page.getByRole('heading', { name: 'Connections', level: 1 })
  ).toBeVisible()
  await expect(
    page.getByText('Connect your tools to unlock the agents.')
  ).toBeVisible()

  // A wrong key is explained and changes nothing.
  let card = await connectKlaviyo(page, 'AbC123')
  await expect(card.getByText(/looks like your public site ID/)).toBeVisible()

  const first = sample('pk_')
  card = await connectKlaviyo(page, first)
  await expect(card.getByRole('status')).toHaveText('Klaviyo Connected')
  await expect(
    card.getByText('Sample data — nothing is sent to Klaviyo.')
  ).toBeVisible()
  await page.reload()
  card = page.locator('section', {
    has: page.getByRole('heading', { name: 'Klaviyo', exact: true })
  })
  await expect(card.getByRole('status')).toHaveText('Klaviyo Connected')
  await expect(card.getByText(/Pulled \d+ templates/i)).toBeVisible()
  await expect(
    card.getByText(` · ${hint(first, 8)}`, { exact: false })
  ).toBeVisible()

  // Swapping keeps the old key when the new one fails, then takes a good one.
  card = await connectKlaviyo(page, 'pk_short')
  await expect(card.getByText(/not a Klaviyo private API key/)).toBeVisible()
  await page.reload()
  await expect(page.getByText(hint(first, 8), { exact: false })).toBeVisible()
  const second = sample('pk_')
  await connectKlaviyo(page, second)
  await page.reload()
  await expect(page.getByText(hint(second, 8), { exact: false })).toBeVisible()

  // Shopify: the form opens full width; an autofilled email is refused.
  const open = page.getByRole('button', {
    name: /^(Connect Shopify|Update access token)$/
  })
  await open.click()
  const form = page.locator('section', {
    has: page.getByRole('heading', { name: 'Connect your Shopify store' })
  })
  const domain = form.getByLabel('Shop domain')
  await expect(domain).toHaveAttribute('autocomplete', 'off')
  await domain.fill('owner@example.com')
  await expect(domain).toHaveAttribute('aria-invalid', 'true')
  const token = sample('shpat_')
  await form.getByLabel('Admin API access token').fill(token)
  await form.getByRole('button', { name: 'Verify & connect' }).click()
  await expect(
    form.getByText(/looks like an email address\. Enter your store/)
  ).toBeVisible()
  const shop = `sample-${randomBytes(3).toString('hex')}`
  await domain.fill(`https://${shop}.myshopify.com/admin`)
  await form.getByLabel('Admin API access token').fill(token)
  await form.getByRole('button', { name: 'Verify & connect' }).click()
  await expect(
    form.getByText(
      'Shopify connected with sample products. Nothing was sent to Shopify.'
    )
  ).toBeVisible()
  await page.reload()
  const shopify = page.locator('section', {
    has: page.getByRole('heading', { name: 'Shopify', exact: true })
  })
  await expect(shopify.getByRole('status')).toHaveText('Shopify Connected')
  await expect(
    shopify.getByText(`${shop}.myshopify.com · ${hint(token, 10)}`)
  ).toBeVisible()

  // The full keys never reach the page.
  const html = await page.content()
  for (const secret of [first, second, token])
    expect(html).not.toContain(secret)
})

test('UIR-013 staff see connection state without connect controls', async ({
  page
}, info) => {
  test.skip(
    info.project.name.startsWith('mobile'),
    'Role check; one layout is enough'
  )
  await login(page, 'staff')
  await page.goto('/connections')
  await expect(
    page.getByRole('heading', { name: 'Connections', level: 1 })
  ).toBeVisible()
  await expect(page.getByLabel(/Private API key/)).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Connect Shopify' })
  ).toHaveCount(0)
})

test('UIR-013 Connections fits a 375px screen and works by keyboard', async ({
  page
}, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Sets its own viewport')
  await page.setViewportSize({ width: 375, height: 812 })
  await login(page, 'owner')
  await page.goto('/connections')
  const fits = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
  expect(await fits()).toBe(true)
  // Open the Shopify form with Enter and move between its fields with Tab.
  const open = page.getByRole('button', {
    name: /^(Connect Shopify|Update access token)$/
  })
  await open.focus()
  await page.keyboard.press('Enter')
  const domain = page.getByLabel('Shop domain')
  await expect(domain).toBeVisible()
  await domain.focus()
  await page.keyboard.type('cedar-lane')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Admin API access token')).toBeFocused()
  expect(await fits()).toBe(true)
})

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
  const field = card.getByLabel(/^(New private|Private) API key$/)
  // Wait for whichever state the page shows before deciding.
  await expect(update.or(field).first()).toBeVisible()
  // The swap form stays open after a refused key, and the toggle would close
  // it again; a click before the page is interactive is retried.
  await expect(async () => {
    if (!(await field.isVisible())) await update.click()
    await expect(field).toBeVisible({ timeout: 2_000 })
  }).toPass()
  await field.fill(key)
  await card
    .getByRole('button', { name: /^(Connect|Validate & swap key)$/ })
    .click()
  return card
}

test('UIR-013 owner connects a sample Klaviyo account; there is no Shopify (v2)', async ({
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
  // The card shows the saved key before the page is reloaded.
  await expect(card.getByText(hint(first, 8), { exact: false })).toBeVisible()
  await expect(
    card.getByText('Sample data — nothing is sent to Klaviyo.')
  ).toBeVisible()
  await page.reload()
  card = page.locator('section', {
    has: page.getByRole('heading', { name: 'Klaviyo', exact: true })
  })
  await expect(card.getByRole('status')).toHaveText('Klaviyo Connected')
  await expect(card.getByText(/Pulled \d+ sample templates/i)).toBeVisible()
  await expect(
    card.getByText(` · ${hint(first, 8)}`, { exact: false })
  ).toBeVisible()

  // Swapping keeps the old key when the new one fails, then takes a good one.
  card = await connectKlaviyo(page, 'pk_short')
  await expect(card.getByText(/not a Klaviyo private API key/)).toBeVisible()
  await page.reload()
  await expect(page.getByText(hint(first, 8), { exact: false })).toBeVisible()
  const second = sample('pk_')
  card = await connectKlaviyo(page, second)
  await expect(card.getByText(hint(second, 8), { exact: false })).toBeVisible()
  await page.reload()
  await expect(page.getByText(hint(second, 8), { exact: false })).toBeVisible()

  // v2 is Klaviyo only (BUILD_BRIEF D2): no Shopify card or form.
  await expect(
    page.getByRole('heading', { name: 'Shopify', exact: true })
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Shopify/ })).toHaveCount(0)

  // The full keys never reach the page.
  const html = await page.content()
  for (const secret of [first, second]) expect(html).not.toContain(secret)
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
  // Staff see the Klaviyo card's state, and no Shopify card at all.
  await expect(
    page.getByRole('heading', { name: 'Klaviyo', exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Shopify', exact: true })
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
  // The Klaviyo key field is reachable and usable by keyboard.
  const update = page.getByRole('button', { name: 'Update API key' })
  const fresh = page.getByLabel('Private API key', { exact: true })
  await expect(update.or(fresh)).toBeVisible()
  if (await update.isVisible()) {
    await update.focus()
    await page.keyboard.press('Enter')
  }
  const key = page.getByLabel(/^(New private|Private) API key$/)
  await key.focus()
  await page.keyboard.type('pk_')
  await expect(key).toHaveValue('pk_')
  expect(await fits()).toBe(true)
})

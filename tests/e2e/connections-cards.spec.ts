import { randomBytes } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { newOwner } from './new-owner'

/**
 * UIR-013 on Settings: UI-OLDc retired the old Connections page; its
 * address opens Settings, whose Klaviyo card connects the store. Staff and
 * the 375 px layout of the card are in settings.spec.
 */

// Random sample keys in the right shape; the app checks format only.
const sample = (prefix: string) =>
  `${prefix}${randomBytes(24).toString('base64url').replace(/[-_]/g, 'x').slice(0, 30)}`

async function connectKlaviyo(page: Page, key: string) {
  const card = page.getByRole('region', { name: 'Klaviyo', exact: true })
  await card.getByLabel(/^(New private|Private) API key$/).fill(key)
  await card
    .getByRole('button', { name: /^(Connect Klaviyo|Change key|Reconnect)$/ })
    .click()
  return card
}

test('UIR-013 owner connects a sample Klaviyo account on Settings; there is no Shopify (v2)', async ({
  page
}) => {
  await newOwner(page, { prefix: 'connect', name: 'Connections studio' })
  // The old address opens Settings.
  await page.goto('/connections')
  await expect(page).toHaveURL(/\/settings$/)

  // A wrong key is explained and changes nothing.
  let card = await connectKlaviyo(page, 'AbC123')
  await expect(card.getByText(/looks like your public site ID/)).toBeVisible()

  const first = sample('pk_')
  card = await connectKlaviyo(page, first)
  await expect(
    card.getByText(/Klaviyo connected with sample data/)
  ).toBeVisible()
  await page.reload()
  await expect(
    card.getByText(`Key ${first.slice(0, 8)}`, { exact: false })
  ).toBeVisible()

  // Swapping keeps the old key when the new one fails, then takes a good one.
  card = await connectKlaviyo(page, 'pk_short')
  await expect(card.getByText(/not a Klaviyo private API key/)).toBeVisible()
  await page.reload()
  await expect(
    card.getByText(`Key ${first.slice(0, 8)}`, { exact: false })
  ).toBeVisible()
  const second = sample('pk_')
  card = await connectKlaviyo(page, second)
  await expect(
    card.getByText(/Klaviyo connected with sample data/)
  ).toBeVisible()
  await page.reload()
  await expect(
    card.getByText(`Key ${second.slice(0, 8)}`, { exact: false })
  ).toBeVisible()

  // v2 is Klaviyo only (BUILD_BRIEF D2): no Shopify anywhere on Settings.
  await expect(page.getByText(/Shopify/)).toHaveCount(0)

  // The full keys never reach the page.
  const html = await page.content()
  for (const secret of [first, second]) expect(html).not.toContain(secret)
})

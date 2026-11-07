import { randomBytes, randomUUID } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { newOwner } from './new-owner'

// Sample keys in the right shape; one ending in 0000 connects ANOTHER
// brand's sample account (a mismatch fixture).
const key = (suffix: string) =>
  `pk_${randomBytes(24).toString('base64url').replace(/[-_]/g, 'x').slice(0, 26)}${suffix}`

async function connectKlaviyo(page: Page, apiKey: string) {
  await page.goto('/connections')
  const card = page.locator('section', {
    has: page.getByRole('heading', { name: 'Klaviyo', exact: true })
  })
  const update = card.getByRole('button', { name: 'Update API key' })
  const fresh = card.getByLabel('Private API key', { exact: true })
  await expect(update.or(fresh)).toBeVisible()
  if (await update.isVisible()) await update.click()
  await card.getByLabel(/^(New private|Private) API key$/).fill(apiKey)
  await card
    .getByRole('button', { name: /^(Connect|Validate & swap key)$/ })
    .click()
  await expect(page.getByText(/connected with sample data/)).toBeVisible()
}

test('UIR-021 the brand check warns before AI steps when Klaviyo is another brand', async ({
  page
}) => {
  await newOwner(page, { prefix: 'guard', name: 'Guard studio' })
  const brandName = `Juniper Field ${randomUUID().slice(0, 6)}`
  await page.goto('/brand')
  const identity = page.getByRole('region', {
    name: 'Brand Identity',
    exact: true
  })
  await identity.getByRole('button', { name: 'Edit Brand Identity' }).click()
  await identity.getByLabel('Brand name', { exact: true }).fill(brandName)
  await identity
    .getByLabel('Website', { exact: true })
    .fill('juniper-field.example')
  await identity.getByRole('button', { name: 'Save Brand Identity' }).click()
  await expect(identity.getByText(/^Saved\./)).toBeVisible()

  // The matching sample account: no warning anywhere.
  await connectKlaviyo(page, key('a1b2'))
  await page.goto('/brand')
  await expect(
    page.getByRole('heading', {
      name: 'This profile may belong to a different brand'
    })
  ).toHaveCount(0)
  await page.goto('/gros')
  await expect(page.getByRole('note', { name: 'Brand check' })).toHaveCount(0)
  await page.goto('/campaign-agent')
  await expect(page.getByRole('note', { name: 'Brand check' })).toHaveCount(0)

  // Another brand's sample account: the Brand page and GROS both warn.
  await connectKlaviyo(page, key('0000'))
  await page.goto('/brand')
  const banner = page.getByRole('region', {
    name: 'This profile may belong to a different brand'
  })
  await expect(banner).toContainText('Northwind Outdoor (sample)')
  await expect(banner).toContainText('northwind-outdoor.example')
  await page.goto('/gros')
  const check = page.getByRole('note', { name: 'Brand check' })
  await expect(check).toContainText(
    'Check your Brand profile before GROS answers.'
  )
  await expect(check).toContainText(brandName)
  await check.getByRole('link', { name: 'Open the Brand profile' }).click()
  await expect(page).toHaveURL(/\/brand$/)
  // The planner warns too, before GROS plans or writes campaigns.
  await page.goto('/campaign-agent')
  await expect(page.getByRole('note', { name: 'Brand check' })).toContainText(
    'Check your Brand profile before GROS plans or writes your campaigns.'
  )

  // Trying the other brand's sample does not move the brand timezone.
  await page.goto('/settings')
  await expect(
    page
      .getByRole('region', { name: 'Timezone' })
      .getByText('Asia/Kathmandu (UTC+05:45)')
  ).toBeVisible()
})

import { randomBytes } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { login } from './accounts'
import { newOwner } from './new-owner'

const sampleKey = () =>
  `pk_${randomBytes(24).toString('base64url').replace(/[-_]/g, 'x').slice(0, 30)}`

async function connectSampleKlaviyo(page: Page) {
  await page.goto('/connections')
  const card = page.locator('section', {
    has: page.getByRole('heading', { name: 'Klaviyo', exact: true })
  })
  await card.getByLabel('Private API key', { exact: true }).fill(sampleKey())
  await card.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(
    page.getByText(/Klaviyo connected with sample data/)
  ).toBeVisible()
}

test('UIR-023 Klaviyo sets the brand timezone; the owner can change it and switch back', async ({
  page
}) => {
  await newOwner(page, { prefix: 'timezone', name: 'Timezone studio' })
  await page.goto('/settings')
  const card = page.getByRole('region', { name: 'Timezone' })
  await expect(card.getByText('Asia/Kathmandu (UTC+05:45)')).toBeVisible()
  await expect(
    card.getByText('Set when the workspace was created.')
  ).toBeVisible()

  // The sample Klaviyo account reports the workspace timezone.
  await connectSampleKlaviyo(page)
  await page.goto('/settings')
  await expect(
    card.getByText('From your Klaviyo account (sample connection).')
  ).toBeVisible()

  // The owner picks another one; it stays after a reload.
  await card.getByLabel('Change timezone').selectOption('Europe/London')
  await card.getByRole('button', { name: 'Save timezone' }).click()
  await expect(
    card.getByText(
      'Saved. The brand timezone is now Europe/London. New plans use it. Campaigns already planned still send at the same moment.'
    )
  ).toBeVisible()
  // The cursor stays on the picker, which shows the new choice.
  await expect(card.getByLabel('Change timezone')).toHaveValue('Europe/London')
  await expect(card.getByLabel('Change timezone')).toBeFocused()
  await page.reload()
  await expect(card.getByText(/^Europe\/London \(UTC/)).toBeVisible()
  await expect(card.getByText('Chosen by you.')).toBeVisible()

  // Klaviyo now differs, so the owner is offered its timezone.
  await expect(
    card.getByText(/Your Klaviyo account \(sample connection\) uses/)
  ).toContainText('Asia/Kathmandu')
  await card.getByRole('button', { name: 'Use Klaviyo’s timezone' }).click()
  await expect(
    card.getByText(
      /^Saved\. The brand timezone is now Klaviyo’s, Asia\/Kathmandu\./
    )
  ).toBeVisible()
  await page.reload()
  await expect(card.getByText('Asia/Kathmandu (UTC+05:45)')).toBeVisible()
  await expect(card.getByText(/Your Klaviyo account/)).toHaveCount(0)

  // Saving the timezone it already has changes nothing.
  await card.getByRole('button', { name: 'Save timezone' }).click()
  await expect(
    card.getByText(
      'Asia/Kathmandu is already the brand timezone. Nothing changed.'
    )
  ).toBeVisible()
  await expect(
    card.getByText('From your Klaviyo account (sample connection).')
  ).toBeVisible()
})

test('UIR-023 staff see the brand timezone but cannot change it', async ({
  page
}, info) => {
  test.skip(
    info.project.name.startsWith('mobile'),
    'Role check; one layout is enough'
  )
  await login(page, 'staff')
  await page.goto('/settings')
  const card = page.getByRole('region', { name: 'Timezone' })
  await expect(card.getByText(/^Asia\/Kathmandu \(UTC\+05:45\)$/)).toBeVisible()
  await expect(card.getByLabel('Change timezone')).toHaveCount(0)
  await expect(
    card.getByRole('button', { name: 'Use Klaviyo’s timezone' })
  ).toHaveCount(0)
})

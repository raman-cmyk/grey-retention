import { randomBytes } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { login } from './accounts'
import { newOwner } from './new-owner'

test('UI-INSa owner follows a brand, sees its emails, builds from one and stops', async ({
  page
}) => {
  test.setTimeout(90_000)
  await newOwner(page, { prefix: 'inspire', name: 'Inspiration studio' })
  // The old shell's Inspiration link opens the new screen.
  await page.goto('/plan')
  await expect(page.locator('a[href="/inspiration"]').first()).toBeAttached()
  // The old address still opens it.
  await page.goto('/library/inspirations')
  await expect(page).toHaveURL(/\/inspiration$/)
  await expect(page).toHaveTitle(/Inspiration/)
  await expect(
    page.getByRole('heading', { name: 'Inspiration', level: 1 })
  ).toBeVisible()
  const followed = page.getByRole('region', { name: 'Brands you follow' })
  await expect(followed.getByText('No brands followed yet.')).toBeVisible()
  await expect(
    page
      .getByRole('region', { name: 'Latest emails' })
      .getByText(/No emails yet/)
  ).toBeVisible()

  // A real website is refused in this sample workspace; the text stays.
  const field = page.getByLabel('Brand website', { exact: true })
  await field.fill('brand.com')
  await page.getByRole('button', { name: 'Follow', exact: true }).click()
  await expect(
    page.getByText(
      /only sample brands, whose websites end in \.example, for example/
    )
  ).toBeVisible()
  await expect(field).toHaveValue('brand.com')

  const domain = `northwind-${randomBytes(4)
    .toString('hex')
    .replace(/[0-9]/g, (d) => 'ghijklmnop'[Number(d)]!)}.example`
  await field.fill(`https://www.${domain}/`)
  await page.getByRole('button', { name: 'Follow', exact: true }).click()
  await expect(page.getByText(`Following ${domain}.`)).toBeVisible()
  const brands = followed.getByRole('list', { name: 'Brands you follow' })
  // The row's title is the brand's website (its details then leave it out).
  await expect(brands.getByText(domain, { exact: true })).toBeVisible()

  // The sample capture brings 10 sample emails (the scheduled worker does
  // this in the app; here the operator button runs it now).
  await page.goto('/competitor-agent')
  await page.getByRole('button', { name: 'Run reference fixture jobs' }).click()
  await expect(
    page.getByText('Reference job pass completed. Inspect persisted evidence.')
  ).toBeVisible()
  await page.goto('/inspiration')
  await expect(brands.getByText(/10 emails/)).toBeVisible()
  const emails = page
    .getByRole('region', { name: 'Latest emails' })
    .getByRole('listitem')
  await expect(emails).toHaveCount(10)
  await expect(emails.first()).toContainText('Sample')
  await expect(
    emails.first().getByRole('link', { name: 'Use this design' })
  ).toHaveAttribute('href', /^\/first-draft\?reference=/)

  // Stop: its emails leave the library.
  await brands.getByRole('button', { name: 'Stop' }).click()
  await expect(followed.getByText('No brands followed yet.')).toBeVisible()
  await page.reload()
  await expect(
    page
      .getByRole('region', { name: 'Latest emails' })
      .getByText(/No emails yet/)
  ).toBeVisible()
})

test('UI-INSa staff see Inspiration but cannot follow, stop, hide or build', async ({
  page
}, info) => {
  test.skip(
    info.project.name.startsWith('mobile'),
    'Role check; one layout is enough'
  )
  await login(page, 'staff')
  await page.goto('/inspiration')
  await expect(
    page.getByRole('heading', { name: 'Inspiration', level: 1 })
  ).toBeVisible()
  await expect(page.getByLabel('Brand website', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Hide' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Use this design' })).toHaveCount(
    0
  )
})

test('UI-INSa Inspiration fits 375px', async ({ page }, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Sets its own viewport')
  await page.setViewportSize({ width: 375, height: 812 })
  await login(page, 'owner')
  await page.goto('/inspiration')
  await expect(
    page.getByRole('heading', { name: 'Brands you follow' })
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})

import { randomBytes } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { login } from './accounts'
import { runWorkspaceJobs } from './jobs'
import { newOwner } from './new-owner'

/** A sample brand's website, unique to the run (letters only). */
const sampleDomain = (name: string) =>
  `${name}-${randomBytes(4)
    .toString('hex')
    .replace(/[0-9]/g, (d) => 'ghijklmnop'[Number(d)]!)}.example`

/**
 * Fits a phone: no sideways scroll, every control on the page at least
 * 44 px tall and inside the screen's width, and no words cut short.
 */
async function fitsPhone(page: Page) {
  const found = await page.evaluate(() => ({
    sideways: document.documentElement.scrollWidth > innerWidth,
    small: [...document.querySelectorAll<HTMLElement>('a, button, input')]
      .filter((el) => {
        const box = el.getBoundingClientRect()
        if (box.width === 0 || el.closest('.sr-only')) return false
        return box.height < 44 || box.right > innerWidth
      })
      .map((el) => el.textContent?.trim() || el.getAttribute('aria-label')),
    cut: [...document.querySelectorAll<HTMLElement>('main *')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .filter((el) => getComputedStyle(el).textOverflow === 'ellipsis')
      .map((el) => el.textContent)
  }))
  expect(found).toEqual({ sideways: false, small: [], cut: [] })
}

test('UI-INSa owner follows a brand, sees its emails, builds from one and stops', async ({
  page
}) => {
  test.setTimeout(90_000)
  await newOwner(page, { prefix: 'inspire', name: 'Inspiration studio' })
  // The top bar's Inspiration link opens the new screen (UI-BRAND-2: Brand
  // assets is a page under Brand now).
  await page.goto('/brand/assets')
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

  const domain = sampleDomain('northwind')
  await field.fill(`https://www.${domain}/`)
  await page.getByRole('button', { name: 'Follow', exact: true }).click()
  await expect(page.getByText(`Following ${domain}.`)).toBeVisible()
  const brands = followed.getByRole('list', { name: 'Brands you follow' })
  // The row's title is the brand's website (its details then leave it out).
  await expect(brands.getByText(domain, { exact: true })).toBeVisible()

  // The sample capture brings 10 sample emails (the scheduled worker does
  // this in the app; here the local fixture dispatch runs it now).
  await runWorkspaceJobs(page)
  await page.goto('/inspiration')
  await expect(brands.getByText(/10 emails/)).toBeVisible()
  const emails = page
    .getByRole('region', { name: 'Latest emails' })
    .getByRole('listitem')
  await expect(emails).toHaveCount(10)
  await expect(emails.first()).toContainText('Sample')
  await expect(
    emails.first().getByRole('link', { name: 'Use this design' })
  ).toHaveAttribute('href', /^\/inspiration\/use\?reference=/)

  // Stop: its emails leave the library.
  await brands.getByRole('button', { name: 'Stop' }).click()
  await expect(followed.getByText('No brands followed yet.')).toBeVisible()
  // The answer stays in the card after the row has gone (UI-INSb review).
  await expect(
    followed.getByText(
      `Stopped following ${domain}. Its emails left your library.`
    )
  ).toBeVisible()
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

test('UI-INSa Inspiration fits 375px: empty, then a followed brand and its emails', async ({
  page
}, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Sets its own viewport')
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 375, height: 812 })
  await newOwner(page, {
    prefix: 'inspire-phone',
    name: 'Inspiration phone studio'
  })
  await page.goto('/inspiration')
  const followed = page.getByRole('region', { name: 'Brands you follow' })
  const latest = page.getByRole('region', { name: 'Latest emails' })
  await expect(followed.getByText('No brands followed yet.')).toBeVisible()
  await expect(latest.getByText(/No emails yet/)).toBeVisible()
  // A whole website fits the field: on a phone Follow goes under it.
  const field = page.getByLabel('Brand website', { exact: true })
  const follow = page.getByRole('button', { name: 'Follow', exact: true })
  const fieldBox = (await field.boundingBox())!
  expect((await follow.boundingBox())!.y).toBeGreaterThanOrEqual(
    fieldBox.y + fieldBox.height
  )
  await fitsPhone(page)

  // A brand with a long website, and its 10 sample emails.
  const domain = sampleDomain('northwind-outdoor-supply-company')
  await field.fill(domain)
  await follow.click()
  await expect(page.getByText(`Following ${domain}.`)).toBeVisible()
  await runWorkspaceJobs(page)
  await page.goto('/inspiration')
  await expect(followed.getByText(domain, { exact: true })).toBeVisible()
  const emails = latest.getByRole('listitem')
  await expect(emails).toHaveCount(10)
  await fitsPhone(page)
  const last = emails.last().getByRole('link', { name: 'Use this design' })
  await last.scrollIntoViewIfNeeded()
  await expect(last).toBeInViewport()
})

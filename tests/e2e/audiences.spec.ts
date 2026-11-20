import { randomBytes } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { newOwner } from './new-owner'

// A key in Klaviyo's format; the fake adapter connects it to sample data.
const sampleKey = () =>
  `pk_${randomBytes(24).toString('base64url').replace(/[-_]/g, 'x').slice(0, 30)}`

/** Connects the signed-in owner's Klaviyo to sample data on Connections. */
async function connectSample(page: Page) {
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

test('UI-AUDa Audiences asks a new store to connect Klaviyo, then lists segments and lists, opens one and comes back', async ({
  page
}) => {
  // A fresh workspace: whatever other specs did to the seed owner's
  // Klaviyo, this one starts not connected.
  await newOwner(page, { prefix: 'audiences', name: 'Audiences studio' })
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Audiences', exact: true })
    .click()
  await expect(page).toHaveURL(/\/audiences$/)
  await expect(
    page.getByRole('heading', { name: 'Audiences', level: 1 })
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Klaviyo not connected', level: 2 })
  ).toBeVisible()
  await page.getByRole('link', { name: 'Connect Klaviyo', exact: true }).click()
  await expect(page).toHaveURL(/\/connections$/)
  await connectSample(page)

  await page.goto('/audiences')
  const segments = page.getByRole('region', { name: 'Segments' })
  const lists = page.getByRole('region', { name: 'Lists' })
  await expect(segments.getByText(/Sample Klaviyo data/)).toBeVisible()
  await expect(segments.getByRole('listitem').first()).toBeVisible()
  await expect(lists.getByRole('listitem').first()).toBeVisible()
  await segments.getByRole('link', { name: 'Open' }).first().click()
  await expect(page).toHaveURL(/\/segments\//)
  await page.getByRole('link', { name: 'Back to Audiences' }).click()
  await expect(page).toHaveURL(/\/audiences$/)
  await lists.getByRole('link', { name: 'Open' }).first().click()
  await expect(page).toHaveURL(/\/lists\//)
  await page.getByRole('link', { name: 'Back to Audiences' }).click()
  await expect(page).toHaveURL(/\/audiences$/)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})

test('UI-AUDb Audiences fits a 375 px phone: not connected, the segments and lists, a key that stopped working', async ({
  page
}, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Sets its own viewport')
  await page.setViewportSize({ width: 375, height: 812 })
  const owner = await newOwner(page, {
    prefix: 'audiences-phone',
    name: 'Audiences phone studio'
  })
  await page.goto('/audiences')
  await expect(
    page.getByRole('heading', { name: 'Klaviyo not connected', level: 2 })
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Connect Klaviyo', exact: true })
  ).toBeInViewport()
  await fitsPhone(page)

  await connectSample(page)
  await page.goto('/audiences')
  const segments = page.getByRole('region', { name: 'Segments' })
  const lists = page.getByRole('region', { name: 'Lists' })
  await expect(segments.getByRole('listitem').first()).toBeVisible()
  await expect(lists.getByRole('listitem').first()).toBeVisible()
  await fitsPhone(page)
  // The last row's Open is reachable too.
  const last = lists.getByRole('link', { name: 'Open' }).last()
  await last.scrollIntoViewIfNeeded()
  await expect(last).toBeInViewport()

  // A sample connection whose key stopped working: the owner's own fixture
  // command marks it expired (sample connections only; a live one changes
  // only through its key check).
  const tenant = await owner.from('tenants').select('id').single()
  expect(tenant.error).toBeNull()
  expect(
    (
      await owner.rpc('set_fixture_connection', {
        t: tenant.data!.id,
        provider: 'klaviyo',
        status: 'expired'
      })
    ).error
  ).toBeNull()
  await page.goto('/audiences')
  await expect(
    page.getByRole('heading', { name: 'Klaviyo key stopped working' })
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Reconnect', exact: true })
  ).toBeInViewport()
  await fitsPhone(page)
})

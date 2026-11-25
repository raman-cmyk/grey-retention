import { randomBytes } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { newOwner } from './new-owner'

// A key in Klaviyo's format; the fake adapter connects it to sample data.
const sampleKey = () =>
  `pk_${randomBytes(24).toString('base64url').replace(/[-_]/g, 'x').slice(0, 30)}`

/**
 * Connects the signed-in owner's Klaviyo to sample data on the Klaviyo card
 * of Settings, where Audiences' Connect Klaviyo leads (UI-AUDc).
 */
async function connectSample(page: Page) {
  if (!new URL(page.url()).pathname.startsWith('/settings'))
    await page.goto('/settings#klaviyo')
  const card = page.getByRole('region', { name: 'Klaviyo', exact: true })
  await card.getByLabel('Private API key', { exact: true }).fill(sampleKey())
  await card.getByRole('button', { name: 'Connect Klaviyo' }).click()
  await expect(
    card.getByText(/Klaviyo connected with sample data/)
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
  await expect(page).toHaveURL(/\/settings#klaviyo$/)
  await connectSample(page)

  await page.goto('/audiences')
  const segments = page.getByRole('region', { name: 'Segments' })
  const lists = page.getByRole('region', { name: 'Lists' })
  await expect(segments.getByText(/Sample Klaviyo data/)).toBeVisible()
  await expect(segments.getByRole('listitem').first()).toBeVisible()
  await expect(lists.getByRole('listitem').first()).toBeVisible()
  // A segment's and a list's page are GROS pages under Audiences (UI-AUDc):
  // the name is the title, Audiences stays current, Back leads back.
  const audiencesItem = page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Audiences', exact: true })
  await segments
    .getByRole('listitem')
    .filter({ hasText: 'Engaged 30 days' })
    .getByRole('link', { name: 'Open' })
    .click()
  await expect(page).toHaveURL(/\/audiences\/segments\/SEGeng030$/)
  await expect(
    page.getByRole('heading', { name: 'Engaged 30 days', level: 1 })
  ).toBeVisible()
  await expect(audiencesItem).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('region', { name: 'Rules' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to Audiences' }).click()
  await expect(page).toHaveURL(/\/audiences$/)
  await lists.getByRole('link', { name: 'Open' }).first().click()
  await expect(page).toHaveURL(/\/audiences\/lists\/[^/]+$/)
  await expect(audiencesItem).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('region', { name: 'Sign-up' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to Audiences' }).click()
  await expect(page).toHaveURL(/\/audiences$/)
  // An id Klaviyo does not have: not found, with the way back.
  await page.goto('/audiences/segments/SEGnone')
  await expect(
    page.getByRole('heading', { name: 'Audience not found' })
  ).toBeVisible()
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
  // A list's and a segment's own page fit the phone too (UI-AUDc).
  await last.click()
  await expect(page).toHaveURL(/\/audiences\/lists\/[^/]+$/)
  await expect(page.getByRole('region', { name: 'Used by' })).toBeVisible()
  await fitsPhone(page)
  await page.goto('/audiences/segments/SEGeng030')
  await expect(page.getByRole('region', { name: 'Rules' })).toBeVisible()
  await fitsPhone(page)

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

test('UI-KLV Results and an audience open Klaviyo’s campaigns, flows, flow emails and metrics', async ({
  page
}) => {
  await newOwner(page, {
    prefix: 'klaviyo-pages',
    name: 'Klaviyo pages studio'
  })
  await connectSample(page)
  const resultsItem = page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Results', exact: true })

  // An audience's "Used by" opens the campaign's own page under Results.
  await page.goto('/audiences/lists/LSTnews01')
  await page
    .getByRole('region', { name: 'Used by' })
    .getByRole('listitem')
    .filter({ hasText: 'Spring restock' })
    .getByRole('link', { name: 'Open' })
    .click()
  await expect(page).toHaveURL(/\/results\/campaigns\/CMPspr001$/)
  await expect(
    page.getByRole('heading', { name: 'Spring restock', level: 1 })
  ).toBeVisible()
  await expect(resultsItem).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('region', { name: 'How it did' })).toBeVisible()
  await expect(page.getByTitle('Preview of Spring restock')).toHaveAttribute(
    'sandbox',
    ''
  )
  await fitsPhone(page)
  await page.getByRole('link', { name: 'Back to Results' }).click()
  await expect(page).toHaveURL(/\/results$/)

  // Results lists Klaviyo's flows; a flow opens its emails and its trigger.
  await page
    .getByRole('region', { name: 'Flows' })
    .getByRole('listitem')
    .filter({ hasText: 'Post-purchase' })
    .getByRole('link', { name: 'Open' })
    .click()
  await expect(page).toHaveURL(/\/results\/flows\/FLWpst004$/)
  await expect(page.getByText('1 of 2 emails is not live.')).toBeVisible()
  await page
    .getByRole('region', { name: 'Steps' })
    .getByRole('listitem')
    .filter({ hasText: 'How was your coffee?' })
    .getByRole('link', { name: 'Open' })
    .click()
  await expect(page).toHaveURL(/\/results\/flow-emails\/FLWpst004M2$/)
  await expect(
    page.getByRole('heading', { name: 'How was your coffee?', level: 1 })
  ).toBeVisible()
  await expect(resultsItem).toHaveAttribute('aria-current', 'page')
  await page.getByRole('link', { name: 'Back to the flow' }).click()
  await expect(page).toHaveURL(/\/results\/flows\/FLWpst004$/)
  await page.getByRole('link', { name: 'Open metric' }).click()
  await expect(page).toHaveURL(/\/results\/metrics\/METord005$/)
  await expect(page.getByText('Someone completed a purchase.')).toBeVisible()
  await fitsPhone(page)

  // Something Klaviyo does not have: not found, with the way back.
  await page.goto('/results/flows/FLWnone')
  await expect(
    page.getByRole('heading', { name: 'Not found in Klaviyo' })
  ).toBeVisible()
  await page.getByRole('link', { name: 'Back to Results' }).click()
  await expect(page).toHaveURL(/\/results$/)
})

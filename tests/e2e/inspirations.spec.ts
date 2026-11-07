import { randomBytes } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { login } from './accounts'
import { newOwner } from './new-owner'

test('UIR-009 owner tracks a competitor, browses its emails and stops tracking', async ({
  page
}) => {
  test.setTimeout(90_000)
  await newOwner(page, { prefix: 'inspire', name: 'Inspiration studio' })
  // The sidebar's Inspiration opens the library.
  await page.goto('/dashboard')
  await expect(
    page.locator('a[href="/library/inspirations"]').first()
  ).toBeAttached()
  await page.goto('/library/inspirations')
  await expect(page).toHaveTitle(/Competitor Inspirations/)
  await expect(
    page.getByRole('heading', { name: 'Competitor Inspirations', level: 1 })
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Back to Campaigns' })
  ).toHaveAttribute('href', '/campaign-agent')
  await expect(
    page.getByRole('heading', { name: /Your competitor domains \(0\/10\)/ })
  ).toBeVisible()
  await expect(page.getByText('No competitor emails yet')).toBeVisible()

  // A real domain is refused in this sample workspace; the text stays.
  const field = page.getByLabel('Competitor domain', { exact: true })
  await field.fill('brand.com')
  await page.getByRole('button', { name: 'Track' }).click()
  await expect(
    page.getByText(
      /only sample domains that end in \.example can be tracked, for example/
    )
  ).toBeVisible()
  await expect(field).toHaveValue('brand.com')

  const domain = `northwind-${randomBytes(3).toString('hex')}.example`
  await field.fill(`https://www.${domain}/`)
  await page.getByRole('button', { name: 'Track' }).click()
  await expect(page.getByText(`Tracking ${domain}.`)).toBeVisible()
  const chips = page.getByRole('list', { name: 'Tracked domains' })
  await expect(chips.getByText(domain, { exact: true })).toBeVisible()
  await expect(chips.getByText('PENDING')).toBeVisible()
  await expect(page.getByText(/usually takes 1–7 days/)).toBeVisible()

  // The sample capture brings 10 sample emails (the scheduled worker does
  // this in the app; here the operator button runs it now).
  await page.goto('/competitor-agent')
  await page.getByRole('button', { name: 'Run reference fixture jobs' }).click()
  await expect(
    page.getByText('Reference job pass completed. Inspect persisted evidence.')
  ).toBeVisible()
  await page.goto('/library/inspirations')
  await expect(chips.getByText('LIVE')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Competitors 10' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Your uploads 0' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Best picks 0' })).toBeVisible()
  const cards = page
    .getByRole('region', { name: 'Reference library' })
    .getByRole('listitem')
  await expect(cards).toHaveCount(10)
  await expect(cards.first()).toContainText('Sample')

  // Search and the Email Text filter, with a count.
  await page.getByLabel('Search the library').fill('reference 3 from')
  await expect(cards).toHaveCount(1)
  await expect(page.getByText('1 email', { exact: true })).toBeVisible()
  await page.getByLabel('Search the library').fill('')
  await page.getByRole('radio', { name: 'Email Text' }).check()
  await expect(cards).toHaveCount(10)

  // The in-page preview is sandboxed and has no links.
  await cards
    .first()
    .getByRole('button', { name: /Open the preview/ })
    .click()
  const dialog = page.getByRole('dialog')
  const frame = dialog.locator('iframe').first()
  await expect(frame).toHaveAttribute('sandbox', '')
  expect(
    await frame.evaluate(
      (f: HTMLIFrameElement) => (f.srcdoc.match(/<a\b[^>]*href/gi) ?? []).length
    )
  ).toBe(0)
  await expect(
    dialog.getByRole('link', { name: /Use this design/ })
  ).toHaveAttribute('href', /^\/first-draft\?reference=/)
  await dialog.getByRole('button', { name: 'Close' }).click()

  // Empty tabs say so plainly.
  await page.getByRole('tab', { name: 'Best picks 0' }).click()
  await expect(page.getByText('No best picks uploaded yet.')).toBeVisible()

  // Stop tracking asks first; its emails leave the library.
  await page.getByRole('button', { name: `Remove ${domain}` }).click()
  const confirm = page.getByRole('alertdialog', {
    name: `Stop tracking ${domain}?`
  })
  await expect(
    confirm.getByText('Its emails will disappear from your library.')
  ).toBeVisible()
  await confirm.getByRole('button', { name: 'Stop tracking' }).click()
  await expect(
    page.getByText(`Stopped tracking ${domain}. Its emails left your library.`)
  ).toBeVisible()
  await page.reload()
  await expect(page.getByRole('tab', { name: 'Competitors 0' })).toBeVisible()
})

test('UIR-009 staff browse the library but cannot track', async ({
  page
}, info) => {
  test.skip(
    info.project.name.startsWith('mobile'),
    'Role check; one layout is enough'
  )
  await login(page, 'staff')
  await page.goto('/library/inspirations')
  await expect(
    page.getByRole('heading', { name: 'Competitor Inspirations', level: 1 })
  ).toBeVisible()
  await expect(
    page.getByLabel('Competitor domain', { exact: true })
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0)
  await expect(page.getByRole('tablist', { name: 'Library' })).toBeVisible()
})

test('UIR-009 Inspiration fits 375px and the tabs work by keyboard', async ({
  page
}, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Sets its own viewport')
  await page.setViewportSize({ width: 375, height: 812 })
  await login(page, 'owner')
  await page.goto('/library/inspirations')
  await expect(page.getByRole('tablist', { name: 'Library' })).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.getByRole('tab', { selected: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: /^Your uploads/ })).toBeFocused()
  await expect(
    page.getByRole('tab', { name: /^Your uploads/ })
  ).toHaveAttribute('aria-selected', 'true')
})

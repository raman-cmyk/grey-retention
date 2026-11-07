import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { login } from './accounts'
import { newOwner } from './new-owner'

// A date about two weeks ahead, as the date field expects it.
function soon(days = 14) {
  const at = new Date(Date.now() + days * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kathmandu',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(at)
}

test('UIR-012 owner adds, edits and deletes an entry and picks a country', async ({
  page
}) => {
  await newOwner(page, { prefix: 'holidays', name: 'Holidays studio' })
  // The sidebar links here now (not to Settings).
  await page.goto('/dashboard')
  await expect(
    page
      .locator('a[href="/holidays"]', { hasText: 'Holidays & Events' })
      .first()
  ).toBeAttached()
  await page.goto('/holidays')
  await expect(
    page.getByRole('heading', { name: 'Holidays & Events', level: 1 })
  ).toBeVisible()
  await expect(page).toHaveTitle(/Holidays & Events/)
  await expect(
    page.getByText('Nothing yet — add your first on the left.')
  ).toBeVisible()

  // Platform list: managed by the product (white-label), country guessed.
  const platform = page.getByRole('region', { name: /Platform holidays/ })
  await expect(platform.getByRole('heading')).toContainText(
    'managed by Grey Retention'
  )
  await expect(platform.getByText(/Guessed from your timezone/)).toBeVisible()
  await platform.getByLabel('Country').selectOption('AU')
  await platform.getByRole('button', { name: 'Save country' }).click()
  await expect(platform.getByText('Country saved.')).toBeVisible()
  // The dropdown keeps the new country (it used to jump back).
  await expect(platform.getByLabel('Country')).toHaveValue('AU')
  await expect(platform.getByText(/Guessed from your timezone/)).toHaveCount(0)
  await page.reload()
  await expect(
    page
      .getByRole('region', { name: /Platform holidays/ })
      .getByLabel('Country')
  ).toHaveValue('AU')
  expect(
    await page
      .getByRole('list', { name: 'Platform holidays' })
      .getByRole('listitem')
      .count()
  ).toBeGreaterThan(0)

  // Add.
  const name = `Summer drop ${randomUUID().slice(0, 6)}`
  const add = page.getByRole('region', { name: 'Add an entry' })
  await add.getByLabel('Name', { exact: true }).fill(name)
  await add.getByLabel('Date', { exact: true }).fill(soon())
  await add.getByLabel('Type', { exact: true }).selectOption('event')
  await add.getByRole('checkbox', { name: /Repeats annually/ }).check()
  await add
    .getByLabel('Notes for the AI strategist (optional)')
    .fill('Tease it a week early.')
  await add.getByRole('button', { name: 'Add entry' }).click()
  await expect(add.getByText(`Added “${name}”.`)).toBeVisible()
  await expect(add.getByLabel('Name', { exact: true })).toHaveValue('')
  const yours = page.getByRole('region', { name: 'Yours' })
  await expect(yours.getByText('1 total')).toBeVisible()
  const row = yours.getByRole('listitem').filter({ hasText: name })
  await expect(row.getByText('Event', { exact: true })).toBeVisible()
  await expect(row.getByText('Every year')).toBeVisible()
  await expect(row.getByText('Tease it a week early.')).toBeVisible()

  // Edit.
  await row.getByRole('button', { name: `Edit ${name}` }).click()
  const renamed = `${name} sale`
  await yours.getByLabel('Name', { exact: true }).fill(renamed)
  await yours.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(yours.getByText('Saved.')).toBeVisible()
  await expect(yours.getByText(renamed, { exact: true })).toBeVisible()
  await expect(
    yours.getByRole('button', { name: `Edit ${renamed}` })
  ).toBeFocused()
  await page.reload()
  await expect(
    page.getByRole('region', { name: 'Yours' }).getByText(renamed, {
      exact: true
    })
  ).toBeVisible()

  // Delete, after confirming.
  await page
    .getByRole('region', { name: 'Yours' })
    .getByRole('button', { name: `Delete ${renamed}` })
    .click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog.getByText(`Delete “${renamed}”?`)).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(
    page.getByText('Nothing yet — add your first on the left.')
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Yours' }).getByText('Deleted.')
  ).toBeVisible()
})

test('UIR-012 staff see the entries but cannot change them', async ({
  page
}, info) => {
  test.skip(
    info.project.name.startsWith('mobile'),
    'Role check; one layout is enough'
  )
  await login(page, 'staff')
  await page.goto('/holidays')
  await expect(
    page.getByRole('heading', { name: 'Holidays & Events', level: 1 })
  ).toBeVisible()
  await expect(page.getByRole('region', { name: 'Add an entry' })).toHaveCount(
    0
  )
  await expect(
    page.getByRole('button', { name: /^(Edit|Delete) / })
  ).toHaveCount(0)
  await expect(
    page
      .getByRole('region', { name: /Platform holidays/ })
      .getByLabel('Country')
  ).toHaveCount(0)
})

test('UIR-012 Holidays fits 375px', async ({ page }, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Sets its own viewport')
  await page.setViewportSize({ width: 375, height: 812 })
  await login(page, 'owner')
  await page.goto('/holidays')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})

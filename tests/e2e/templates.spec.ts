import { test, expect } from '@playwright/test'
import { login } from './accounts'
test('UC-15 protected fixture sweep, timed winback, audited suppression and guarded reversal persist', async ({
  page
}, info) => {
  await login(page, info.project.name.startsWith('mobile') ? 'other' : 'owner')
  await page.goto('/optimizer')
  await page
    .getByRole('button', {
      name: 'Install original profile fixtures',
      exact: true
    })
    .click()
  await expect(
    page.getByRole('heading', { name: 'original-fixture-3', exact: true })
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Preview protected candidates', exact: true })
    .click()
  await expect(
    page.getByText(
      /2 eligible · 6 protected or excluded · 0 synthetic suppressions/
    )
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Review first sweep approval', exact: true })
    .click()
  await page
    .getByRole('button', {
      name: 'Approve reviewed fixture sweep',
      exact: true
    })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Sweep · approved · v2', exact: true })
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Run optimizer fixture jobs', exact: true })
    .click()
  await expect(
    page.getByRole('heading', {
      name: 'Sweep · winback_wait · v3',
      exact: true
    })
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Advance fixture sweep clock', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Sweep · completed · v5', exact: true })
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByText(
      'original-fixture-3 · excluded · protected purchaser 12 months',
      { exact: true }
    )
  ).toBeVisible()
  await expect(
    page.getByText(
      'original-fixture-1 · recovered · synthetic positive engagement',
      { exact: true }
    )
  ).toBeVisible()
  const profile = page.locator('article').filter({
    has: page.getByRole('heading', {
      name: 'original-fixture-2',
      exact: true
    })
  })
  await expect(profile).toContainText('Suppression reasons: optimizer')
  await profile
    .getByRole('button', { name: 'Review fixture reversal', exact: true })
    .click()
  await page
    .getByRole('button', {
      name: 'Confirm guarded fixture reversal',
      exact: true
    })
    .click()
  await expect(profile).toContainText('Suppression reasons: none')
  await page.reload()
  await expect(page.getByText(/original-fixture-2 · reversed ·/)).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: `.audit/optimizer-${info.project.name}.png`,
    fullPage: true
  })
})
test('UC-16 own performance links and original structural draft require normal approval', async ({
  page
}, info) => {
  await login(page, info.project.name.startsWith('mobile') ? 'other' : 'owner')
  await page.goto('/email-library')
  await expect(
    page.getByText(/Synthetic 7d metrics: complete · clicks/)
  ).toBeVisible()
  const ownStructure = await page
    .getByLabel('Authorized structure')
    .locator('option[value^="own_template:"]')
    .first()
    .getAttribute('value')
  await page.getByLabel('Authorized structure').selectOption(ownStructure!)
  await page
    .getByLabel('New draft title')
    .fill(`Original derived ${info.project.name}`)
  await page
    .getByLabel('New draft goal')
    .fill('An original educational note, using only own structure.')
  await page
    .getByLabel('New draft send time (ISO with timezone)')
    .fill(new Date(Date.now() + 300 * 86400000).toISOString())
  await page.getByLabel('New draft format').selectOption('email_text')
  await page
    .getByRole('button', {
      name: 'Create unapproved structural draft',
      exact: true
    })
    .click()
  await expect(page).toHaveURL(/\/campaigns\//)
  await expect(
    page.getByRole('button', { name: 'Approve calendar v1', exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('button', {
      name: 'Review scheduling confirmation',
      exact: true
    })
  ).toHaveCount(0)
  await page.reload()
  await expect(
    page.getByRole('heading', {
      name: `Original derived ${info.project.name}`,
      exact: true
    })
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Approve calendar v1', exact: true })
    .click()
  await expect(
    page.getByRole('button', {
      name: 'Queue original fixture copy',
      exact: true
    })
  ).toBeVisible()
})

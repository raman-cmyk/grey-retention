import { test, expect } from '@playwright/test'
import { login } from './accounts'
test('UC-12 windowed fixture results, insufficient learning and default L2 boundary persist', async ({
  page
}, info) => {
  await login(page, info.project.name.startsWith('mobile') ? 'other' : 'owner')
  await page.goto('/reports')
  await expect(
    page.getByRole('heading', { name: 'Results & learning', exact: true })
  ).toBeVisible()
  await page
    .getByRole('button', {
      name: 'Advance fixture reporting clock',
      exact: true
    })
    .click()
  await expect(
    page
      .getByText(
        'Synthetic reporting operation persisted. No measured revenue, real send or paid AI.',
        { exact: true }
      )
      .first()
  ).toBeVisible()
  // Each request drains at most four fixture jobs, oldest available first.
  // Jobs left by earlier journeys in this shared tenant can use that budget
  // before both matured pulls (which share one timestamp), so drain the
  // remainder through the owner's existing run control.
  const sevenDay = page.getByRole('heading', {
    name: /Synthetic L1 send .* · 7d/
  })
  const twoDay = page.getByRole('heading', {
    name: /Synthetic L1 send .* · 48h/
  })
  await expect(async () => {
    if ((await sevenDay.count()) && (await twoDay.count())) return
    await page
      .getByRole('button', { name: 'Run reporting fixture jobs', exact: true })
      .click()
    await expect(sevenDay).toBeVisible({ timeout: 3_000 })
    await expect(twoDay).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
  await expect(sevenDay).toBeVisible()
  await expect(twoDay).toBeVisible()
  await page.reload()
  await expect(
    page.getByText('Complete · Comparable cohort · source: fixture').first()
  ).toBeVisible()
  await page
    .getByRole('button', {
      name: 'Queue fixture learning comparison',
      exact: true
    })
    .click()
  await expect(
    page.getByText(
      'Insufficient evidence. No learned rule influences generation.',
      { exact: true }
    )
  ).toBeVisible()
  await expect(page.getByText(/Learning run · insufficient/)).toBeVisible()
  await expect(
    page.getByText(
      /Consecutive synthetic sends: 1 \/ 10\. Simulation: (disabled|enabled)\. Production: unavailable\./
    )
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Review L2 simulation policy', exact: true })
    .click()
  await page.getByLabel('Silence simulation').selectOption('true')
  await page
    .getByRole('button', { name: 'Save L2 simulation policy', exact: true })
    .click()
  await expect(
    page.getByText(/Simulation: enabled. Production: unavailable./)
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(
    page.getByText(/Simulation: enabled. Production: unavailable./)
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: `.audit/results-${info.project.name}.png`,
    fullPage: true
  })
  await page.context().clearCookies()
  await login(page, 'staff')
  await page.goto('/reports')
  await expect(
    page.getByText(
      'Workspace owner or admin is required to read revenue and learning.',
      { exact: true }
    )
  ).toBeVisible()
  await expect(page.getByText(/Synthetic revenue/)).toHaveCount(0)
})

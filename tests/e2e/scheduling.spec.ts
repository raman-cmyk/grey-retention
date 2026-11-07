import { expect, test } from '@playwright/test'
import { login } from './accounts'
test('UC-09 persisted timeout reconciliation, reschedule, cancellation and L1 send confirmation', async ({
  page
}, info) => {
  // About 40 server actions in a row. On CI this runs 20+ minutes into the
  // suite on one dev server, where 150s was not always enough (it ran out
  // at the last reload). Its retries cannot pass: the first attempt has
  // already used Synthetic 1.
  test.setTimeout(process.env.CI ? 300_000 : 150_000)
  await login(page, info.project.name.startsWith('mobile') ? 'other' : 'owner')
  await page.goto('/campaign-agent')
  const planner = page.locator('section').filter({
    has: page.getByRole('heading', {
      name: 'Guarded 30-day planning',
      exact: true
    })
  })
  await planner
    .getByRole('link', { name: /Synthetic 1\b/ })
    .first()
    .click()
  await page
    .getByLabel('Synthetic fault scenario')
    .selectOption('timeout_after_success')
  await page
    .getByRole('button', { name: 'Save fixture fault', exact: true })
    .click()
  await expect(
    page.getByText('Fixture operation saved.', { exact: true })
  ).toBeVisible()
  await page
    .getByRole('button', {
      name: 'Review scheduling confirmation',
      exact: true
    })
    .click()
  await page
    .getByRole('button', { name: /Confirm package v\d+ scheduling/ })
    .click()
  await expect(page.getByText(/Campaign delivery: queued/)).toBeVisible()
  await page
    .getByRole('button', { name: 'Run queued fixture jobs', exact: true })
    .click()
  await expect(page.getByText(/Campaign delivery: reconciling/)).toBeVisible()
  await expect(
    page.getByText(/Fixture identity .* · scheduled ·/)
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Retry resolved fixture job', exact: true })
    .click()
  await expect(
    page.getByText('Fixture operation saved.', { exact: true }).last()
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Run queued fixture jobs', exact: true })
    .click()
  await expect(page.getByText(/Campaign delivery: scheduled/)).toBeVisible()
  await page
    .getByRole('button', { name: 'Review rescheduling', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Confirm fixture reschedule', exact: true })
    .click()
  await expect(page.getByText(/Campaign delivery: scheduling/)).toBeVisible()
  await page
    .getByRole('button', { name: 'Run queued fixture jobs', exact: true })
    .click()
  await expect(page.getByText(/Campaign delivery: scheduled/)).toBeVisible()
  await page
    .getByLabel('Synthetic fault scenario')
    .selectOption('cancel_rejected')
  await page
    .getByRole('button', { name: 'Save fixture fault', exact: true })
    .click()
  await expect(
    page.getByText('Fixture operation saved.', { exact: true }).first()
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Review cancellation', exact: true })
    .click()
  await page
    .getByRole('button', {
      name: 'Request simulated cancellation',
      exact: true
    })
    .click()
  await expect(
    page.getByText(
      'Intent queued. Run fixture jobs to obtain a confirmed outcome.',
      { exact: true }
    )
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await page
    .getByRole('button', { name: 'Run queued fixture jobs', exact: true })
    .click()
  await expect(page.getByText(/delivery.cancel: validation/)).toBeVisible()
  await expect(page.getByText(/Campaign delivery: scheduled/)).toBeVisible()
  await page.getByLabel('Synthetic fault scenario').selectOption('none')
  await page
    .getByRole('button', { name: 'Save fixture fault', exact: true })
    .click()
  await expect(
    page.getByText('Fixture operation saved.', { exact: true }).first()
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Retry resolved fixture job', exact: true })
    .click()
  await expect(
    page.getByText('Fixture operation saved.', { exact: true }).last()
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Run queued fixture jobs', exact: true })
    .click()
  await expect(page.getByText(/Campaign delivery: cancelled/)).toBeVisible()
  await page.goto('/settings')
  await page
    .getByRole('button', { name: 'Review delivery policy', exact: true })
    .click()
  await page.getByLabel('Delivery level').selectOption('L1')
  await page.getByLabel('Background fixture scheduling').selectOption('true')
  await page
    .getByLabel('Default postal address')
    .fill('42 Original Fictional Road, Synthetic Town')
  await page
    .getByRole('button', { name: 'Save owner delivery policy', exact: true })
    .click()
  await expect(
    page.getByText(
      'Owner standing policy saved. Run fixture jobs to dispatch ready packages.',
      { exact: true }
    )
  ).toBeVisible()
  await page.goto('/campaign-agent')
  await page
    .getByLabel('Campaign title')
    .fill(`Synthetic L1 send ${info.project.name}`)
  await page
    .getByLabel(/^Send time/)
    .fill(new Date(Date.now() + 200 * 86400000).toISOString())
  await page.getByLabel('Email format').selectOption('email_text')
  await page
    .getByLabel('Audience', { exact: true })
    .selectOption({ label: 'G | Engaged (fixture definition)' })
  await page
    .getByRole('button', { name: 'Create campaign', exact: true })
    .click()
  await expect(page).toHaveURL(/\/campaigns\//)
  await page
    .getByRole('button', { name: 'Approve calendar v1', exact: true })
    .click()
  await expect(
    page.getByRole('button', {
      name: 'Queue original fixture copy',
      exact: true
    })
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Queue original fixture copy', exact: true })
    .click()
  await expect(
    page.getByText(
      'Intent queued. Run fixture jobs to obtain a confirmed outcome.',
      { exact: true }
    )
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Run queued fixture jobs', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Approve copy v2', exact: true })
    .click()
  await expect(
    page.getByRole('button', {
      name: 'Queue original fixture design',
      exact: true
    })
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Queue original fixture design', exact: true })
    .click()
  await expect(
    page.getByText(
      'Original fixture render queued. Run campaign fixture jobs.',
      { exact: true }
    )
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Run queued fixture jobs', exact: true })
    .click()
  await page
    .getByRole('button', {
      name: 'Review fixture design approval',
      exact: true
    })
    .click()
  await page
    .getByRole('button', {
      name: 'Approve exact fixture design v3',
      exact: true
    })
    .click()
  await expect(
    page.getByText('Owner approved exact fixture design v3.', { exact: true })
  ).toBeVisible()
  await expect(page.getByLabel('Footer postal address')).toHaveValue(
    '42 Original Fictional Road, Synthetic Town'
  )
  await page
    .getByRole('button', {
      name: 'Validate fixture delivery package',
      exact: true
    })
    .click()
  await expect(
    page.getByRole('heading', { name: /Final delivery preview/ })
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Run queued fixture jobs', exact: true })
    .click()
  await expect(page.getByText(/Campaign delivery: scheduled/)).toBeVisible()
  await page
    .getByRole('button', { name: 'Review simulated send clock', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Confirm synthetic send', exact: true })
    .click()
  await expect(page.getByText(/Campaign delivery: sent/)).toBeVisible()
  await page.reload()
  await expect(page.getByText(/Campaign delivery: sent/)).toBeVisible()
  await expect(
    page
      .getByLabel('Rendering structure')
      .locator('option')
      .filter({ hasText: 'own skeleton' })
  ).toHaveCount(1)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: `.audit/scheduling-${info.project.name}.png`,
    fullPage: true
  })
})
test('UC-09 confirmed text package preview remains readable after reload', async ({
  page
}, info) => {
  await login(page, info.project.name.startsWith('mobile') ? 'other' : 'owner')
  const month = new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 7)
  await page.goto(`/campaign-agent?m=${month}`)
  await page
    .getByRole('link')
    .filter({ hasText: `Synthetic L1 send ${info.project.name}` })
    .first()
    .click()
  const preview = page.frameLocator('iframe[title="Final email preview"]')
  await expect(
    preview.getByRole('link', { name: 'Unsubscribe', exact: true })
  ).toBeVisible()
  await expect(
    preview.getByText(/This is original synthetic copy/)
  ).toBeVisible()
  await page.locator('iframe').scrollIntoViewIfNeeded()
  await page.screenshot({
    path: `.audit/delivery-preview-${info.project.name}.png`
  })
})

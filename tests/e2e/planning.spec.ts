import { test, expect } from '@playwright/test'
import { login } from './accounts'
import { localWeek } from '../../features/planning/guards'
test('UC-05/06 guarded month review and exact weekly copy batch persist', async ({
  page
}, info) => {
  test.setTimeout(120_000)
  const role = info.project.name.startsWith('mobile') ? 'other' : 'owner'
  const start = new Date(Date.now() + 7 * 86400000).toISOString()
  const timezone = role === 'owner' ? 'Asia/Kathmandu' : 'Australia/Melbourne'
  const eventSlot = new Date(start)
  while (
    ['Sat', 'Sun'].includes(
      new Intl.DateTimeFormat('en', {
        timeZone: timezone,
        weekday: 'short'
      }).format(eventSlot)
    )
  ) {
    eventSlot.setUTCDate(eventSlot.getUTCDate() + 1)
  }
  const eventDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(eventSlot)
  const eventName = `Original studio day ${info.project.name}`
  await login(page, role)
  await page.goto('/settings')
  await page.getByLabel('Event name').fill(eventName)
  await page.getByLabel('Event date').fill(eventDate)
  await page
    .getByLabel('Event notes')
    .fill('Original owner-supplied event; no offer implied.')
  await page
    .getByRole('button', { name: 'Save workspace event', exact: true })
    .click()
  await expect(
    page.getByText(
      `${eventDate} · ${eventName} · Original owner-supplied event; no offer implied.`,
      { exact: true }
    )
  ).toBeVisible()
  await page.goto('/brand')
  await page
    .getByLabel('Offer label', { exact: true })
    .fill('Synthetic planning whitelist')
  await page.getByLabel('Offer type', { exact: true }).selectOption('evergreen')
  await page.getByLabel('Maximum discount percent').fill('0')
  await page
    .getByLabel('Offer conditions')
    .fill('No discount or invented urgency. Original synthetic whitelist.')
  await page
    .getByLabel('Valid from (ISO UTC)')
    .fill(new Date(Date.now() - 86400000).toISOString())
  await page
    .getByLabel('Valid until (ISO UTC)')
    .fill(new Date(Date.now() + 365 * 86400000).toISOString())
  await page
    .getByRole('button', { name: 'Save permitted offer', exact: true })
    .click()
  await expect(
    page.getByText('Synthetic planning whitelist', { exact: true })
  ).toBeVisible()
  await page.goto('/competitor-agent')
  for (const label of ['alpha', 'beta', 'gamma']) {
    await page
      .getByLabel('Fictional capture domain')
      .fill(`synthetic-${label}.example`)
    await page
      .getByLabel('Reference label', { exact: true })
      .fill(`Fixture ${label}`)
    await page
      .getByLabel('Private workspace rules', { exact: true })
      .fill('Original synthetic structural guidance.')
    await page
      .getByRole('button', { name: 'Save private subscription', exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: `Fixture ${label}`, exact: true })
    ).toBeVisible()
    await page
      .getByRole('button', {
        name: `Queue fixture capture for Fixture ${label}`,
        exact: true
      })
      .click()
    await expect(
      page.getByRole('button', {
        name: `Queue fixture capture for Fixture ${label}`,
        exact: true
      })
    ).toBeEnabled()
  }
  await page.getByRole('button', { name: 'Run reference fixture jobs' }).click()
  await expect(
    page.getByText('10/10 captured emails', { exact: true })
  ).toHaveCount(3)
  const before = await page
    .getByRole('heading', { name: /^Playbook v/ })
    .count()
  await page.getByRole('button', { name: 'Queue brand playbook' }).click()
  await expect(
    page.getByRole('button', { name: 'Queue brand playbook' })
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Run reference fixture jobs' }).click()
  await expect(page.getByRole('heading', { name: /^Playbook v/ })).toHaveCount(
    before + 1
  )
  await page.goto('/campaign-agent')
  await page
    .getByLabel('Rolling start (ISO timestamp with timezone)')
    .fill(start)
  await page.getByRole('button', { name: 'Queue rolling fixture plan' }).click()
  await expect(
    page.getByText('calendar.plan · queued · attempt 0/4', { exact: true })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Run planning fixture jobs' }).click()
  await expect(
    page.getByRole('button', { name: 'Review plan approval' })
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: new RegExp(eventName) }).first()
  ).toBeVisible()
  expect(
    await page.getByRole('link', { name: /Synthetic \d+/ }).count()
  ).toBeGreaterThan(10)
  const firstEntryText = await page
    .locator('section')
    .filter({
      has: page.getByRole('heading', {
        name: 'Guarded 30-day planning',
        exact: true
      })
    })
    .getByRole('link', { name: /Synthetic \d+/ })
    .first()
    .textContent()
  const firstEntryTime = firstEntryText!.match(
    /\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:\d{2})/
  )![0]
  await page.getByRole('button', { name: 'Review plan approval' }).click()
  await page
    .getByRole('button', {
      name: 'Approve reviewed calendar plan',
      exact: true
    })
    .click()
  // The submit button relabels to "Saving…" while pending, so its absence does
  // not prove completion. The outer review control renders only while proposed
  // entries exist, so it unmounts only after the approval has persisted.
  await expect(
    page.getByRole('button', { name: 'Review plan approval', exact: true })
  ).toHaveCount(0)
  await page.goto(
    `/copy-review?week=${localWeek(firstEntryTime, role === 'owner' ? 'Asia/Kathmandu' : 'Australia/Melbourne')}`
  )
  await page.getByRole('button', { name: 'Queue approved-entry copy' }).click()
  await expect(
    page.getByRole('button', { name: 'Queue approved-entry copy' })
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Run planning fixture jobs' }).click()
  await expect(
    page.getByText(/copy.generate · succeeded/).first()
  ).toBeVisible()
  // A bounded worker pass processes four; complete a second pass if needed.
  await page.getByRole('button', { name: 'Run planning fixture jobs' }).click()
  await expect(
    page.getByRole('button', { name: 'Run planning fixture jobs' })
  ).toBeEnabled()
  await page
    .getByRole('button', { name: 'Prepare exact weekly review' })
    .click()
  await expect(
    page.getByRole('heading', {
      name: 'Immutable review batch · open',
      exact: true
    })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Review bulk copy approval' }).click()
  await page
    .getByRole('button', { name: 'Approve exact weekly copy batch' })
    .click()
  await expect(
    page.getByRole('heading', {
      name: 'Immutable review batch · approved',
      exact: true
    })
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('heading', {
      name: 'Immutable review batch · approved',
      exact: true
    })
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({
    path: `.audit/planning-${info.project.name}.png`,
    fullPage: true
  })
})

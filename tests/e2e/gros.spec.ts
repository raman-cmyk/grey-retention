import { test, expect } from '@playwright/test'
import { login } from './accounts'
test('UC-11 creator-private/shared chats and actor-bound confirmed draft edits persist', async ({
  page
}, info) => {
  await login(page)
  await page.goto('/gros')
  const privateTitle = `Synthetic private ${info.project.name}`
  await page.getByLabel('Conversation title').fill(privateTitle)
  await page
    .getByRole('button', { name: 'Create conversation', exact: true })
    .click()
  await expect(page).toHaveURL(/\/gros\?chat=/)
  await expect(
    page
      .getByRole('navigation', { name: 'Conversations', exact: true })
      .locator('a[aria-current="page"]')
  ).toContainText(privateTitle)
  await expect(
    page.getByRole('heading', {
      name: 'Your conversation starts here',
      exact: true
    })
  ).toBeVisible()
  const privateUrl = page.url()
  const campaign = await page
    .getByLabel('Campaign context')
    .locator('option')
    .nth(1)
    .getAttribute('value')
  await page.getByLabel('Campaign context').selectOption(campaign!)
  const question = `Original private question ${info.project.name}`
  await page.getByLabel('Question or reason').fill(question)
  await page.getByRole('button', { name: 'Ask GROS', exact: true }).click()
  await expect(page.getByText(question, { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText(/Next step:/)).toBeVisible()
  const sharedTitle = `Synthetic shared ${info.project.name}`
  await page.getByLabel('Conversation title').fill(sharedTitle)
  await page
    .getByLabel('Conversation visibility', { exact: true })
    .selectOption('shared')
  await page
    .getByRole('button', { name: 'Create conversation', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: `${sharedTitle} · shared`, exact: true })
  ).toBeVisible()
  const sharedUrl = page.url()
  await page.getByLabel('Campaign context').selectOption(campaign!)
  await page
    .getByLabel('Question or reason')
    .fill('Propose a new original education goal.')
  await page.getByLabel('GROS request').selectOption('edit_goal')
  await page
    .getByLabel('Proposed goal', { exact: true })
    .fill(`Original synthetic GROS goal ${info.project.name}`)
  await page.getByRole('button', { name: 'Ask GROS', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'edit_goal · pending', exact: true })
  ).toBeVisible()
  const proposal = page
    .getByRole('heading', { name: 'edit_goal · pending', exact: true })
    .locator('..')
  await expect(proposal.locator('pre')).toBeHidden()
  await proposal.getByText('Inspect exact payload', { exact: true }).click()
  await expect(proposal.locator('pre')).toContainText(
    `Original synthetic GROS goal ${info.project.name}`
  )
  await page
    .getByRole('button', { name: 'Review proposal confirmation', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Confirm proposal decision', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'edit_goal · confirmed', exact: true })
  ).toBeVisible()
  await page.getByLabel('Campaign context').selectOption(campaign!)
  await page.getByLabel('GROS request').selectOption('edit_goal')
  await page
    .getByLabel('Question or reason')
    .fill('Another proposal must remain mine.')
  await page
    .getByLabel('Proposed goal', { exact: true })
    .fill('Original pending education goal')
  await page.getByRole('button', { name: 'Ask GROS', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'edit_goal · pending', exact: true })
  ).toBeVisible()
  await page.context().clearCookies()
  await login(page, 'staff')
  await page.goto(privateUrl)
  await expect(
    page.getByText('Conversation unavailable to your active membership.', {
      exact: true
    })
  ).toBeVisible()
  await expect(page.getByText(question, { exact: true })).toHaveCount(0)
  await page.goto(sharedUrl)
  await expect(
    page.getByRole('heading', { name: `${sharedTitle} · shared`, exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('button', {
      name: 'Review proposal confirmation',
      exact: true
    })
  ).toHaveCount(0)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: `.audit/gros-${info.project.name}.png`,
    fullPage: true
  })
  await page.context().clearCookies()
  await login(page, 'other')
  await page.goto(sharedUrl)
  await expect(
    page.getByText('Conversation unavailable to your active membership.', {
      exact: true
    })
  ).toBeVisible()
})
test('UC-18 team invitation audit, event and support response survive refresh', async ({
  page
}, info) => {
  await login(page)
  // The team is on Settings (UI-SETb, UI-SETc).
  await page.goto('/settings')
  const email = `synthetic-${info.project.name}-${Date.now()}@grey-retention.test`
  const team = page.getByRole('region', { name: 'Team' })
  await team.getByLabel('Email', { exact: true }).fill(email)
  await team
    .getByRole('button', { name: 'Invite as Staff', exact: true })
    .click()
  const invitation = team
    .getByRole('list', { name: 'Pending invites' })
    .getByRole('listitem')
    .filter({ hasText: email })
  await expect(invitation).toBeVisible()
  await invitation
    .getByRole('button', { name: `Cancel invite: ${email}`, exact: true })
    .click()
  await expect(invitation).toHaveCount(0)
  await page.reload()
  await expect(team.getByText(email)).toHaveCount(0)
  // The audit survives the refresh.
  await expect(
    page
      .getByRole('region', { name: 'Recent changes' })
      .getByText(`Invite to ${email} cancelled`, { exact: false })
  ).toBeVisible()
  // Holidays and events are a page under Settings (UI-SETd).
  await page.goto('/settings/holidays')
  const add = page.getByRole('region', { name: 'Add a date' })
  await add
    .getByLabel('Name', { exact: true })
    .fill(`Synthetic event ${info.project.name}`)
  await add.getByLabel('Date', { exact: true }).fill('2027-01-01')
  await add.getByLabel('Type', { exact: true }).selectOption('event')
  await add
    .getByLabel('Notes for GROS (optional)')
    .fill('Original fixture event.')
  await add.getByRole('button', { name: 'Add date', exact: true }).click()
  await expect(
    page.getByText(`Added “Synthetic event ${info.project.name}”.`)
  ).toBeVisible()
  await expect(
    page.getByText(`Synthetic event ${info.project.name}`, { exact: true })
  ).toBeVisible()
  // Support is a card on Settings (UI-SETd).
  await page.goto('/support')
  await expect(page).toHaveURL(/\/settings$/)
  const subject = `Synthetic support ${info.project.name}`
  const support = page.getByRole('region', { name: 'Support' })
  await support.getByLabel('Subject', { exact: true }).fill(subject)
  await support
    .getByLabel('Your question', { exact: true })
    .fill('Original synthetic workflow question.')
  await support
    .getByRole('button', { name: 'Send to support', exact: true })
    .click()
  await expect(
    support.getByText('Sent to support. Their reply shows here.')
  ).toBeVisible()
  const question = support
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: subject, exact: true }) })
    .first()
  await expect(question).toContainText('Open')
  await page.context().clearCookies()
  await login(page, 'admin')
  await page.goto('/admin/operations')
  // UI-ADM: each thread is a tile in the GROS support queue.
  const thread = page
    .getByRole('list', { name: 'Support threads' })
    .getByRole('listitem')
    .filter({
      has: page.getByRole('heading', { name: subject, exact: true })
    })
    .first()
  await expect(thread).toContainText('Support · Open')
  // Exact: the Save button's spoken label also says "thread reply".
  await thread
    .getByLabel('Thread reply', { exact: true })
    .fill('Original operator response; fixture outcome inspected.')
  await thread
    .getByLabel('Ticket state', { exact: true })
    .selectOption('closed')
  await thread
    .getByRole('button', {
      name: `Save thread reply: ${subject}`,
      exact: true
    })
    .click()
  await expect(thread).toContainText('Support · Closed')
  await expect(
    page.getByText(`Original private question ${info.project.name}`, {
      exact: true
    })
  ).toHaveCount(0)
  await page.context().clearCookies()
  await login(page)
  await page.goto('/settings')
  await expect(
    question.getByText(
      'Original operator response; fixture outcome inspected.',
      {
        exact: true
      }
    )
  ).toBeVisible()
  await page.reload()
  await expect(question).toContainText('Closed')
  // A member's reply opens the closed thread again.
  await question
    .getByLabel(`Your reply to ${subject}`, { exact: true })
    .fill('Thanks, that answers it.')
  await question
    .getByRole('button', { name: `Send reply: ${subject}`, exact: true })
    .click()
  await expect(support.getByText('Reply sent.')).toBeVisible()
  await expect(question).toContainText('Thanks, that answers it.')
  await expect(question).toContainText('Open')
})

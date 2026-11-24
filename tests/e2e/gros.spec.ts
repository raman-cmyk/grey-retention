import { test, expect } from '@playwright/test'
import { login } from './accounts'
import { ask, firstCampaign, startChat } from './chats'

test('UC-11 creator-private/shared chats and actor-bound confirmed draft edits persist', async ({
  page
}, info) => {
  await login(page)
  // Ask GROS (UI-ASK): the GROS page behind the bar's Ask GROS button.
  await page.goto('/gros')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ask GROS', exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Ask GROS', exact: true })
  ).toHaveAttribute('aria-current', 'page')
  const privateTitle = `Synthetic private ${info.project.name}`
  await startChat(page, privateTitle)
  await expect(
    page.getByRole('heading', { name: 'No messages yet', exact: true })
  ).toBeVisible()
  const privateUrl = page.url()
  const campaign = await firstCampaign(page)
  const question = `Original private question ${info.project.name}`
  await ask(page, { campaign, question })
  await expect(page.getByText(question, { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText(/Next step:/)).toBeVisible()
  const sharedTitle = `Synthetic shared ${info.project.name}`
  await startChat(page, sharedTitle, 'shared')
  const chat = page.getByRole('region', { name: sharedTitle, exact: true })
  await expect(
    chat.getByRole('heading', { name: sharedTitle, exact: true })
  ).toBeVisible()
  await expect(chat.getByText('Shared · Started by you')).toBeVisible()
  const sharedUrl = page.url()
  const goal = `Original synthetic GROS goal ${info.project.name}`
  await ask(page, {
    campaign,
    request: 'edit_goal',
    goal,
    question: 'Propose a new original education goal.'
  })
  // Newest first: the proposal just made is the first one.
  const proposal = page
    .getByRole('list', { name: 'Proposals', exact: true })
    .getByRole('listitem')
    .first()
  await expect(
    proposal.getByRole('heading', { name: 'Goal change', exact: true })
  ).toBeVisible()
  await expect(proposal).toContainText('Waiting for you')
  await expect(proposal.locator('pre')).toBeHidden()
  await proposal.getByText('Show the exact change', { exact: true }).click()
  await expect(proposal.locator('pre')).toContainText(goal)
  await proposal
    .getByRole('button', { name: 'Confirm change: Goal change', exact: true })
    .click()
  await expect(proposal).toContainText('Confirmed')
  await expect(
    proposal.getByRole('button', { name: /^Confirm change/ })
  ).toHaveCount(0)
  await ask(page, {
    campaign,
    request: 'edit_goal',
    goal: 'Original pending education goal',
    question: 'Another proposal must remain mine.'
  })
  await expect(proposal).toContainText('Waiting for you')
  await page.context().clearCookies()
  await login(page, 'staff')
  await page.goto(privateUrl)
  await expect(
    page.getByRole('heading', { name: 'Chat not available', exact: true })
  ).toBeVisible()
  await expect(page.getByText(question, { exact: true })).toHaveCount(0)
  await page.goto(sharedUrl)
  await expect(
    page.getByRole('heading', { name: sharedTitle, exact: true })
  ).toBeVisible()
  // Only the member who asked confirms; staff see it waiting.
  await expect(
    page.getByRole('button', { name: /^Confirm change/ })
  ).toHaveCount(0)
  await expect(
    page.getByText('Waiting for the person who asked').first()
  ).toBeVisible()
  // Only the member who started the chat changes who sees it.
  await expect(
    page.getByRole('button', { name: 'Make private', exact: true })
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
    page.getByRole('heading', { name: 'Chat not available', exact: true })
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
  const thread = page.locator('article').filter({
    has: page.getByRole('heading', {
      name: `${subject} · support · open`,
      exact: true
    })
  })
  await thread
    .getByLabel('Thread reply')
    .fill('Original operator response; fixture outcome inspected.')
  await thread.getByLabel('Ticket state').selectOption('closed')
  await thread
    .getByRole('button', { name: 'Save thread reply', exact: true })
    .click()
  await expect(
    page.getByRole('heading', {
      name: `${subject} · support · closed`,
      exact: true
    })
  ).toBeVisible()
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

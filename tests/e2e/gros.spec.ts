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
  await page.goto('/team')
  const email = `synthetic-${info.project.name}-${Date.now()}@grey-retention.test`
  const invite = page.getByRole('region', { name: 'Invite a teammate' })
  await invite.getByLabel('Email', { exact: true }).fill(email)
  await invite.getByRole('button', { name: 'Send invite', exact: true }).click()
  const invitation = page
    .getByRole('region', { name: /Pending invites/ })
    .getByRole('listitem')
    .filter({ hasText: email })
  await expect(invitation).toBeVisible()
  await invitation
    .getByRole('button', { name: `Cancel invite to ${email}`, exact: true })
    .click()
  await expect(invitation).toHaveCount(0)
  await page.reload()
  await expect(
    page.getByRole('region', { name: /Pending invites/ }).getByText(email)
  ).toHaveCount(0)
  // The audit survives the refresh.
  await expect(
    page
      .getByRole('region', { name: 'Recent team changes' })
      .getByText(`Invite to ${email} cancelled`, { exact: false })
  ).toBeVisible()
  await page.goto('/holidays')
  await page
    .getByLabel('Name', { exact: true })
    .fill(`Synthetic event ${info.project.name}`)
  await page.getByLabel('Date', { exact: true }).fill('2027-01-01')
  await page.getByLabel('Type', { exact: true }).selectOption('event')
  await page
    .getByLabel('Notes for the AI strategist (optional)')
    .fill('Original fixture event.')
  await page.getByRole('button', { name: 'Add entry', exact: true }).click()
  await expect(
    page.getByText(`Added “Synthetic event ${info.project.name}”.`)
  ).toBeVisible()
  await expect(
    page.getByText(`Synthetic event ${info.project.name}`, { exact: true })
  ).toBeVisible()
  await page.goto('/support')
  const subject = `Synthetic support ${info.project.name}`
  await page.getByLabel('Ticket subject').fill(subject)
  await page
    .getByLabel('Support message')
    .fill('Original synthetic workflow question.')
  await page
    .getByRole('button', { name: 'Save support request', exact: true })
    .click()
  await expect(
    page.getByRole('heading', {
      name: `${subject} · support · open`,
      exact: true
    })
  ).toBeVisible()
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
  await page.goto('/support')
  await expect(
    page
      .getByText('Original operator response; fixture outcome inspected.', {
        exact: true
      })
      .last()
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('heading', {
      name: `${subject} · support · closed`,
      exact: true
    })
  ).toBeVisible()
})

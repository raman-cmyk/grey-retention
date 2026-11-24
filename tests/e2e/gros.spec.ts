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

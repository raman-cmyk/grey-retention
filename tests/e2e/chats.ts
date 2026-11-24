import { expect, type Page } from '@playwright/test'

/**
 * Ask GROS (UI-ASK) steps the chat journeys share. With no chats yet the
 * page is the empty state, whose one button starts a private "First chat";
 * then the Chats card starts the named one.
 */
export async function startChat(
  page: Page,
  name: string,
  who: 'private' | 'shared' = 'private'
) {
  const first = page.getByRole('button', { name: 'Start a chat', exact: true })
  const chats = page.getByRole('region', { name: 'Chats', exact: true })
  // The loading page already shows the title: wait until the page has
  // settled on the empty state or the Chats card before choosing.
  await expect(first.or(chats).first()).toBeVisible()
  if (await first.isVisible()) {
    await first.click()
    await expect(page).toHaveURL(/\/gros\?chat=/)
  }
  await chats.getByLabel('Chat name', { exact: true }).fill(name)
  await chats.getByLabel('Who can see it', { exact: true }).selectOption(who)
  await chats.getByRole('button', { name: 'Start chat', exact: true }).click()
  await expect(page).toHaveURL(/\/gros\?chat=/)
  await expect(
    page
      .getByRole('navigation', { name: 'Conversations', exact: true })
      .locator('a[aria-current="page"]')
  ).toContainText(name)
}

/** The first campaign a question can name. */
export async function firstCampaign(page: Page) {
  const value = await page
    .getByLabel('Campaign', { exact: true })
    .locator('option')
    .nth(1)
    .getAttribute('value')
  expect(value).toBeTruthy()
  return value!
}

/** Asks in the open chat with the composer's one button, Send. */
export async function ask(
  page: Page,
  {
    campaign,
    question,
    request,
    goal
  }: { campaign: string; question: string; request?: string; goal?: string }
) {
  await page.getByLabel('Campaign', { exact: true }).selectOption(campaign)
  if (request)
    await page.getByLabel('Request', { exact: true }).selectOption(request)
  if (goal !== undefined)
    await page.getByLabel('New goal', { exact: true }).fill(goal)
  await page.getByLabel('Your question', { exact: true }).fill(question)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
}

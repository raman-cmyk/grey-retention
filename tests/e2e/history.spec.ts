import { test, expect } from '@playwright/test'
import { login } from './accounts'

test('UC-11 paged GROS history keeps old and newest messages after refresh', async ({
  page
}, info) => {
  test.setTimeout(240_000)
  await login(page)
  await page.goto('/gros/new')
  const box = page.getByLabel('Message GROS', { exact: true })
  const say = async (text: string) => {
    await box.fill(text)
    await box.press('Control+Enter')
    await expect(box).toHaveValue('', { timeout: 15_000 })
  }
  const q = (n: number) => `Original history question ${info.project.name} ${n}`
  await say(q(0))
  await expect(page).toHaveURL(/\/gros\/[0-9a-f-]{36}$/)
  // The share dialog opens from the keyboard, Escape closes it and focus returns.
  const share = page.getByRole('button', { name: 'Make shared', exact: true })
  await share.focus()
  await share.press('Enter')
  const dialog = page.getByRole('alertdialog', {
    name: 'Share this chat with your team?'
  })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(share).toBeFocused()
  await expect(page.getByText('PRIVATE', { exact: true })).toBeVisible()
  // 26 questions and answers: more than the 50 messages one page shows.
  for (let n = 1; n < 26; n++) {
    await say(q(n))
    await expect(page.getByText(q(n), { exact: true })).toBeVisible()
  }
  await page.reload()
  const messages = page.getByRole('list', { name: 'Messages', exact: true })
  await expect(messages.getByText(q(25), { exact: true })).toBeVisible()
  await expect(messages.getByText(q(0), { exact: true })).toHaveCount(0)
  await page
    .getByRole('link', { name: 'Earlier messages', exact: true })
    .click()
  await expect(messages.getByText(q(0), { exact: true })).toBeVisible()
  await expect(messages.getByText(q(25), { exact: true })).toHaveCount(0)
  await expect(page.getByText(/^Hi .+ — I'm GROS/)).toBeVisible()
  await page.getByRole('link', { name: 'Latest messages', exact: true }).click()
  await expect(messages.getByText(q(25), { exact: true })).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})

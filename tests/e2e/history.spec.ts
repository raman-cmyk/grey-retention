import { test, expect } from '@playwright/test'
import { login } from './accounts'
import { ask, firstCampaign, startChat } from './chats'

test('UC-11 paged GROS history retains old and newest messages after refresh', async ({
  page
}, info) => {
  test.setTimeout(180_000)
  await login(page)
  await page.goto('/gros')
  const title = `Synthetic paged history ${info.project.name}`
  await startChat(page, title)
  // The starter of a private chat can share it (it asks first).
  await expect(
    page.getByRole('button', { name: 'Share chat', exact: true })
  ).toBeVisible()
  const campaign = await firstCampaign(page)
  for (let n = 0; n < 51; n++) {
    await ask(page, {
      campaign,
      question: `Original history question ${info.project.name} ${n}`
    })
    await expect(
      page.getByText(`Original history question ${info.project.name} ${n}`, {
        exact: true
      })
    ).toBeVisible()
  }
  await page.reload()
  await expect(
    page.getByText(`Original history question ${info.project.name} 0`, {
      exact: true
    })
  ).toHaveCount(0)
  await page
    .getByRole('link', { name: 'Show earlier messages', exact: true })
    .click()
  await expect(
    page.getByText(`Original history question ${info.project.name} 0`, {
      exact: true
    })
  ).toBeVisible()
  await expect(
    page.getByText(`Original history question ${info.project.name} 50`, {
      exact: true
    })
  ).toHaveCount(0)
  await page
    .getByRole('link', { name: 'Show latest messages', exact: true })
    .click()
  await expect(
    page.getByText(`Original history question ${info.project.name} 50`, {
      exact: true
    })
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})

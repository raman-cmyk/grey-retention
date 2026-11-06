import { test, expect } from '@playwright/test'
import { login } from './accounts'

test('UC-11 paged GROS history retains old and newest messages after refresh', async ({
  page
}, info) => {
  test.setTimeout(180_000)
  await login(page)
  await page.goto('/gros')
  const title = `Synthetic paged history ${info.project.name}`
  await page.getByLabel('Conversation title').fill(title)
  await page
    .getByRole('button', { name: 'Create conversation', exact: true })
    .click()
  await expect(page).toHaveURL(/\/gros\?chat=/)
  const review = page.getByRole('button', {
    name: 'Review conversation visibility',
    exact: true
  })
  await review.focus()
  await review.press('Enter')
  const dialog = page.getByRole('dialog', {
    name: 'Confirm conversation visibility',
    exact: true
  })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(review).toBeFocused()
  const campaign = await page
    .getByLabel('Campaign context')
    .locator('option')
    .nth(1)
    .getAttribute('value')
  for (let n = 0; n < 51; n++) {
    await page.getByLabel('Campaign context').selectOption(campaign!)
    await page
      .getByLabel('Question or reason')
      .fill(`Original history question ${info.project.name} ${n}`)
    await page.getByRole('button', { name: 'Ask GROS', exact: true }).click()
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
    .getByRole('link', { name: 'Earlier messages', exact: true })
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
  await page.getByRole('link', { name: 'Latest messages', exact: true }).click()
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

import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

/** The local owner's sign-in (the same accounts `login` uses). */
const owner = () =>
  (
    JSON.parse(readFileSync('.audit/local-accounts.json', 'utf8')) as Record<
      'owner',
      { email: string; password: string }
    >
  ).owner

async function signIn(page: Page) {
  const { email, password } = owner()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

test('BAS-003 a signed-out owner signs in and lands back on the page they opened', async ({
  page
}) => {
  await page.goto('/plan')
  await expect(page).toHaveURL(/\/login\?next=%2Fplan$/)
  await signIn(page)
  await expect(page).toHaveURL(/\/plan$/, { timeout: 15_000 })
})

test('BAS-003 a sign-in link pointing at another site lands on Home', async ({
  page
}) => {
  await page.goto('/login?next=https%3A%2F%2Fevil.example%2F')
  await signIn(page)
  await expect(page).toHaveURL(/\/home$/, { timeout: 15_000 })
})

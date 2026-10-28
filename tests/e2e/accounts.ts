import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'
export type AccountRole = 'owner' | 'admin' | 'designer' | 'other' | 'staff'
export async function login(page: Page, role: AccountRole = 'owner') {
  const accounts = JSON.parse(
    readFileSync('.audit/local-accounts.json', 'utf8')
  ) as Record<AccountRole, { email: string; password: string }>
  const path =
    role === 'admin'
      ? '/admin/login'
      : role === 'designer'
        ? '/designer/login'
        : '/login'
  await page.goto(path)
  await page.getByLabel('Email').fill(accounts[role].email)
  await page.getByLabel('Password').fill(accounts[role].password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(
    role === 'admin'
      ? /\/admin\/dashboard/
      : role === 'designer'
        ? /\/designer\/dashboard/
        : /\/dashboard/,
    { timeout: 15_000 }
  )
}

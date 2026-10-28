import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'

test('a new owner creates a workspace and resumes saved brand setup', async ({
  page
}, info) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (
    process.env.GREY_LOCAL_E2E !== '1' ||
    !url ||
    !['localhost', '127.0.0.1'].includes(new URL(url).hostname)
  )
    throw new Error(
      'Onboarding acceptance requires a disposable loopback database.'
    )
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const suffix = randomUUID()
  const email = `onboarding-${suffix}@grey-retention.test`
  const password = randomUUID()
  const result = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  })
  expect(result.error).toBeNull()

  await page.goto('/get-started')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/onboarding$/)
  await page
    .getByLabel('What is your brand called?')
    .fill(`Setup ${suffix.slice(0, 8)}`)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/get-started$/)
  await expect(
    page.getByRole('heading', { name: 'Which store is yours?' })
  ).toBeVisible()
  await page.getByLabel('Store website (optional)').fill('setup-store.example')
  await page.getByText('Brand voice and rules · optional').click()
  await page.getByLabel('How should your emails sound?').fill('Warm and clear')
  await page.getByLabel('Anything we should avoid?').fill('No medical claims')
  await page.getByRole('button', { name: 'Save brand details' }).click()
  await expect(
    page.getByRole('heading', { name: 'Start with one email.' })
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Start with one email.' })
  ).toBeVisible()
  await page.getByRole('link', { name: /Your brand/ }).click()
  await expect(page.getByLabel('Store website (optional)')).toHaveValue(
    'setup-store.example'
  )
  await page.getByText('Brand voice and rules · optional').click()
  await expect(page.getByLabel('How should your emails sound?')).toHaveValue(
    'Warm and clear'
  )
  await expect(page.getByLabel('Anything we should avoid?')).toHaveValue(
    'No medical claims'
  )
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.getByText('Brand voice and rules · optional').click()
  await page.screenshot({
    path: `.audit/onboarding-${info.project.name}.png`,
    fullPage: true
  })
  await page.getByRole('link', { name: 'Exit setup' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(
    page.getByRole('heading', { name: 'New here? Start with one email.' })
  ).toBeVisible()
})

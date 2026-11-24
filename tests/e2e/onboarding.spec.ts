import { randomBytes, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { runReaders } from './readers'

// UI-ONBe: a new owner creates a workspace, lands on /setup and walks the
// five steps to Home, doing Klaviyo and the discount while his website is
// still being read. Sample Klaviyo only: the key's format is checked.
test('a new owner creates a workspace and sets up the store to Home', async ({
  page,
  request
}) => {
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

  await page.goto('/setup')
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/onboarding$/)
  const name = `Setup ${suffix.slice(0, 8)}`
  await page.getByLabel('What is your brand called?').fill(name)
  await page
    .getByRole('button', { name: 'Create workspace', exact: true })
    .click()

  // A new workspace lands on the setup flow, at Store.
  await expect(page).toHaveURL(/\/setup$/)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your store' })
  ).toBeVisible()
  await expect(page.getByLabel('Store name')).toHaveValue(name)
  await page.getByLabel('Website').fill('setup-store.example')
  await page.getByRole('button', { name: 'Save store' }).click()
  // The website is read first (it can take hours): Brand waits, and he
  // goes on with Klaviyo and the discount meanwhile.
  await expect(
    page.getByRole('heading', { level: 1, name: 'Connect Klaviyo' })
  ).toBeVisible()
  await expect(
    page
      .getByRole('list', { name: 'Steps' })
      .getByRole('link', { name: /Brand.*Reading your website/ })
  ).toBeVisible()
  await page
    .getByLabel('Private API key')
    .fill(
      `pk_${randomBytes(24).toString('base64url').replace(/[-_]/g, 'x').slice(0, 30)}`
    )
  await page.getByRole('button', { name: 'Connect Klaviyo' }).click()
  await page.getByLabel('Biggest discount, in percent').fill('0')
  await page.getByRole('button', { name: 'Save discount' }).click()

  // A real store cannot follow a real brand yet: it skips.
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your rivals' })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  // Only the waiting Brand is left: no Finish yet, and Home is the way on.
  await expect(
    page.getByRole('heading', { level: 1, name: 'Almost ready' })
  ).toBeVisible()
  await expect(
    page.getByText(
      'We’ll ask you to confirm your brand once your website is read.'
    )
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Finish setup' })).toHaveCount(
    0
  )
  await page.getByRole('link', { name: 'Open Home' }).click()
  await expect(page).toHaveURL(/\/home$/)

  // Once the website was read, Brand is Now again; confirming it opens
  // the finish.
  await runReaders(request)
  await page.goto('/setup')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your brand' })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Confirm brand' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ready to plan' })
  ).toBeVisible()
  await expect(page.getByText('setup-store.example')).toBeVisible()
  await expect(page.getByText('0%')).toBeVisible()
  await page.getByRole('button', { name: 'Finish setup' }).click()
  await expect(page).toHaveURL(/\/home$/)
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: /^Good (morning|afternoon|evening), /
    })
  ).toBeVisible()

  // Finished: setup alone goes Home; a done step still opens.
  await page.goto('/setup')
  await expect(page).toHaveURL(/\/home$/)
  await page.goto('/setup?step=store')
  await expect(page.getByLabel('Website')).toHaveValue('setup-store.example')
  // A new website after finishing: the brand is looked at again first, not
  // Home. The new website's own read is queued, so Brand waits for it
  // (ONB-SITEa: the old website's read does not count) and the finish says
  // so; once it is read, the Brand step opens and confirming it goes Home.
  await page.getByLabel('Website').fill('setup-store-two.example')
  await page.getByRole('button', { name: 'Save store' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Almost ready' })
  ).toBeVisible()
  await runReaders(request)
  await page.reload()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Your brand' })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Confirm brand' }).click()
  await expect(page).toHaveURL(/\/home$/)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})

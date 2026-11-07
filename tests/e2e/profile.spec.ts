import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { test, expect, type Page } from '@playwright/test'

// A fresh owner so changing the password never affects the shared accounts.
async function freshOwner(page: Page) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (
    process.env.GREY_LOCAL_E2E !== '1' ||
    !['localhost', '127.0.0.1'].includes(new URL(url).hostname)
  )
    throw new Error('Disposable local database required.')
  const options = { auth: { persistSession: false, autoRefreshToken: false } }
  const admin = createClient(
    url,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    options
  )
  const unique = randomUUID()
  const email = `profile-${unique}@grey-retention.test`
  const password = randomUUID()
  expect(
    (
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      })
    ).error
  ).toBeNull()
  const db = createClient(
    url,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    options
  )
  expect(
    (await db.auth.signInWithPassword({ email, password })).error
  ).toBeNull()
  expect(
    (
      await db.rpc('create_tenant_workspace', {
        workspace_name: 'Profile test studio',
        workspace_slug: `profile-${unique}`,
        workspace_timezone: 'Asia/Kathmandu'
      })
    ).error
  ).toBeNull()
  await signIn(page, email, password)
  return { email, password }
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/(dashboard|get-started)/)
}

test('UIR-014 owner updates details and changes password with inline checks', async ({
  page
}, info) => {
  const { email, password } = await freshOwner(page)
  if (info.project.name.startsWith('mobile')) {
    // The drawer links here and closes after the click.
    await page.getByRole('button', { name: 'Open navigation' }).click()
    const drawer = page.locator('dialog[open]')
    await drawer.getByRole('link', { name: 'Profile Update' }).click()
    await expect(page.locator('dialog[open]')).toHaveCount(0)
  } else {
    // The account menu links here (it was "coming soon" before) and closes.
    const menu = page
      .getByRole('button', { name: /^Open account menu for / })
      .first()
    await menu.click()
    await page.getByRole('link', { name: 'Profile Update' }).click()
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
  }
  await expect(page).toHaveURL(/\/profile$/)
  await expect(
    page.getByRole('heading', { name: 'Profile', level: 1 })
  ).toBeVisible()

  // Account information.
  const emailField = page.getByLabel('Email')
  await expect(emailField).toBeDisabled()
  await expect(emailField).toHaveValue(email)
  await expect(
    page.getByRole('link', { name: 'support', exact: true })
  ).toHaveAttribute('href', '/support')
  await page.getByLabel('Name', { exact: true }).fill('Rae Sample Owner')
  await page.getByLabel('Job title').fill('Founder')
  await page.getByLabel('Phone').fill('+977 1 555 0101')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
    'Rae Sample Owner'
  )
  await expect(page.getByLabel('Job title')).toHaveValue('Founder')
  await expect(page.getByLabel('Phone')).toHaveValue('+977 1 555 0101')

  // Wrong current password, mismatch and short password: inline, nothing changes.
  const current = page.getByLabel('Current password')
  const next = page.getByLabel('New password', { exact: true })
  const confirm = page.getByLabel('Confirm new password')
  const update = page.getByRole('button', { name: 'Update password' })
  await current.fill('not-my-password')
  await next.fill('brand-new-password')
  await confirm.fill('brand-new-password')
  await update.click()
  await expect(
    page.getByText('That is not your current password.')
  ).toBeVisible()
  await current.fill(password)
  await next.fill('brand-new-password')
  await confirm.fill('another-password')
  await update.click()
  await expect(page.getByText('The new passwords do not match.')).toBeVisible()
  await current.fill(password)
  await next.fill('short')
  await confirm.fill('short')
  // The browser blocks the submit (minlength); the server says the same.
  await next.evaluate((input: HTMLInputElement) =>
    input.removeAttribute('minlength')
  )
  await update.click()
  await expect(page.getByText('Use at least 12 characters.')).toBeVisible()

  // A real change works and the new password signs in.
  const fresh = `new-${randomUUID()}`
  await current.fill(password)
  await next.fill(fresh)
  await confirm.fill(fresh)
  await update.click()
  await expect(page.getByText('Password updated.')).toBeVisible()
  await expect(current).toHaveValue('')
  await page.context().clearCookies()
  // The old password no longer works; the new one does.
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByText('Email or password is incorrect.')).toBeVisible()
  await signIn(page, email, fresh)
})

test('UIR-014 Profile fits 375px and works by keyboard', async ({
  page
}, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Sets its own viewport')
  await page.setViewportSize({ width: 375, height: 812 })
  await freshOwner(page)
  await page.goto('/profile')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  // Wait until the page is interactive, so hydration cannot move the focus.
  await page.waitForLoadState('networkidle')
  const name = page.getByLabel('Name', { exact: true })
  await name.click()
  await expect(name).toBeFocused()
  // The locked email is skipped; its help links to support.
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('link', { name: 'support', exact: true })
  ).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Job title')).toBeFocused()
})

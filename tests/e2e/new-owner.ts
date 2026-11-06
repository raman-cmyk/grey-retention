import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, type Page } from '@playwright/test'

// Creates a fresh synthetic owner and workspace on the disposable loopback stack.
export async function newOwner(
  page: Page,
  { prefix = 'composer', name = 'Original composer studio' } = {}
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (
    process.env.GREY_LOCAL_E2E !== '1' ||
    !url ||
    !['localhost', '127.0.0.1'].includes(new URL(url).hostname)
  )
    throw new Error('Disposable local database required.')
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const unique = randomUUID()
  const email = `${prefix}-${unique}@grey-retention.test`,
    password = randomUUID()
  expect(
    (
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      })
    ).error
  ).toBeNull()
  const db = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  expect(
    (await db.auth.signInWithPassword({ email, password })).error
  ).toBeNull()
  const workspace = await db.rpc('create_tenant_workspace', {
    workspace_name: name,
    workspace_slug: `${prefix}-${unique}`,
    workspace_timezone: 'Asia/Kathmandu'
  })
  expect(workspace.error).toBeNull()
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  return db
}

import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page } from '@playwright/test'
import { login } from './accounts'

async function newOwner(page: Page) {
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
  const email = `composer-${unique}@grey-retention.test`,
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
    workspace_name: 'Original composer studio',
    workspace_slug: `composer-${unique}`,
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

test('owner creates and reopens the same original draft without integrations', async ({
  page
}, info) => {
  const db = await newOwner(page)
  await page.goto('/first-draft')
  await expect(page).toHaveURL(/\/first-draft\?attempt=[a-f0-9-]+$/)
  const attemptUrl = page.url()
  await page.reload()
  await expect(page).toHaveURL(attemptUrl)
  const title = `Original first draft ${randomUUID()}`
  await page
    .getByLabel('What should this email do?')
    .fill('Introduce our original studio to new subscribers.')
  await page.getByText('Plan details · optional').click()
  await page.getByLabel('Give it a name').fill(title)
  await page
    .getByLabel('Planned date and time · Asia/Kathmandu')
    .fill('2099-04-05T10:30')
  if (info.project.name.startsWith('mobile'))
    await page.setViewportSize({ width: 320, height: 800 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.getByText('Plan details · optional').click()
  await page.screenshot({
    path: `.audit/first-draft-${info.project.name}.png`,
    fullPage: true
  })
  await page.getByRole('button', { name: 'Create my draft' }).click()
  await expect(page).toHaveURL(/\/campaigns\/[a-f0-9-]+$/)
  const savedUrl = page.url()
  await expect(
    page.getByRole('heading', { name: title, exact: true })
  ).toBeVisible()
  const saved = await db
    .from('campaigns')
    .select('planned_at,calendar_state,copy_state,delivery_state,audience_id')
    .eq('id', savedUrl.split('/').at(-1)!)
    .single()
  expect(saved.error).toBeNull()
  expect(new Date(saved.data!.planned_at).toISOString()).toBe(
    '2099-04-05T04:45:00.000Z'
  )
  expect(saved.data).toMatchObject({
    calendar_state: 'proposed',
    copy_state: 'draft',
    delivery_state: 'not_ready',
    audience_id: null
  })
  await page.goto('/dashboard')
  await page
    .getByRole('link', { name: new RegExp(title) })
    .first()
    .click()
  await expect(page).toHaveURL(savedUrl)
  await page.reload()
  await expect(
    page.getByRole('heading', { name: title, exact: true })
  ).toBeVisible()
})

test('an authorized reference preview starts a structural draft with source lineage', async ({
  page
}, info) => {
  const db = await newOwner(page)
  await page.goto('/competitor-agent')
  await page
    .getByLabel('Fictional capture domain')
    .fill(`composer-${randomUUID()}.example`)
  await page
    .getByLabel('Reference label', { exact: true })
    .fill('Original composer sample')
  await page
    .getByRole('button', { name: 'Save private subscription', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Original composer sample', exact: true })
  ).toBeVisible()
  await page
    .getByRole('button', {
      name: 'Queue fixture capture for Original composer sample',
      exact: true
    })
    .click()
  await expect(
    page.getByRole('button', {
      name: 'Queue fixture capture for Original composer sample',
      exact: true
    })
  ).toBeEnabled()
  await page
    .getByRole('button', { name: 'Run reference fixture jobs', exact: true })
    .click()
  await expect(
    page.getByText('10/10 captured emails', { exact: true })
  ).toBeVisible()
  await page.goto('/email-library')
  await page
    .getByRole('link', { name: 'Open safe preview and evidence' })
    .first()
    .click()
  await expect(page).toHaveURL(/\/email-library\/[a-f0-9-]+$/)
  const referenceId = page.url().split('/').at(-1)!
  await page.getByRole('link', { name: 'Use for my brand' }).click()
  await expect(page.getByLabel('Start with')).toHaveValue(referenceId)
  await page.getByText('See the original email', { exact: true }).click()
  const frame = page.frameLocator('iframe[title="Selected reference preview"]')
  await expect(frame.locator('body')).toContainText('Original fictional')
  expect(await frame.locator('script, img, form').count()).toBe(0)
  await page.screenshot({
    path: `.audit/first-draft-reference-${info.project.name}.png`,
    fullPage: true
  })
  await page
    .getByLabel('What should this email do?')
    .fill('Adapt the section order using our original brand facts.')
  await page.getByRole('button', { name: 'Create my draft' }).click()
  await expect(page).toHaveURL(/\/campaigns\/[a-f0-9-]+$/)
  const result = await db
    .from('campaigns')
    .select('lineage,calendar_state')
    .eq('id', page.url().split('/').at(-1)!)
    .single()
  expect(result.error).toBeNull()
  expect(result.data!.lineage).toMatchObject({
    structureId: referenceId,
    structureSource: 'reference_structure',
    copyReusable: false
  })
  expect(result.data!.calendar_state).toBe('proposed')
  await page.goto(`/first-draft?reference=${referenceId}`)
  await expect(page.getByLabel('Start with')).toHaveValue(referenceId)
  await page
    .getByLabel('What should this email do?')
    .fill('Preserve this idea if the selected reference becomes unavailable.')
  const capture = await db
    .from('competitor_emails')
    .select('capture_id')
    .eq('id', referenceId)
    .single()
  const subscription = await db
    .from('competitor_subscriptions')
    .select('id,tenant_id,revision,private_rules')
    .eq('capture_id', capture.data!.capture_id)
    .single()
  expect(
    (
      await db.rpc('update_competitor_subscription', {
        t: subscription.data!.tenant_id,
        subscription: subscription.data!.id,
        expected_revision: subscription.data!.revision,
        active: false,
        private_rules: subscription.data!.private_rules
      })
    ).error
  ).toBeNull()
  await page.getByRole('button', { name: 'Create my draft' }).click()
  await expect(
    page.getByText(
      'This source is no longer available. Choose another reference or start from scratch.'
    )
  ).toBeVisible()
  await expect(page.getByLabel('What should this email do?')).toHaveValue(
    'Preserve this idea if the selected reference becomes unavailable.'
  )
  await expect(page.getByLabel('Start with')).toHaveValue(referenceId)
  await page.getByLabel('Start with').selectOption('original')
  await page.getByRole('button', { name: 'Create my draft' }).click()
  await expect(page).toHaveURL(/\/campaigns\/[a-f0-9-]+$/)
})

test('staff can view setup but cannot open owner composer controls', async ({
  page
}) => {
  await login(page, 'staff')
  await page.goto('/first-draft')
  await expect(
    page.getByText('Ask your workspace owner to create a draft.')
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Create my draft' })
  ).toHaveCount(0)
})

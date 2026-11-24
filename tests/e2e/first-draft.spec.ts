import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { login } from './accounts'
import { runWorkspaceJobs } from './jobs'
import { newOwner } from './new-owner'

/**
 * UI-OLDc: "Use this design" and the draft it saves are GROS screens
 * (`/inspiration/use`, `/plan/draft/<id>`); the old `/first-draft` and
 * `/campaigns/<id>` addresses open them.
 */

/** A sample brand's website, unique to the run (letters only). */
const sampleDomain = (name: string) =>
  `${name}-${randomBytes(4)
    .toString('hex')
    .replace(/[0-9]/g, (d) => 'ghijklmnop'[Number(d)]!)}.example`

test('owner creates and reopens the same draft from scratch without integrations', async ({
  page
}, info) => {
  const db = await newOwner(page)
  await page.goto('/first-draft')
  await expect(page).toHaveURL(/\/inspiration\/use\?attempt=[a-f0-9-]+$/)
  const attemptUrl = page.url()
  await page.reload()
  await expect(page).toHaveURL(attemptUrl)
  await expect(
    page.getByRole('heading', { name: 'New draft', level: 1 })
  ).toBeVisible()
  const title = `Original first draft ${randomUUID()}`
  await page
    .getByLabel('What should this email do?')
    .fill('Introduce our original studio to new subscribers.')
  await page.getByLabel('Name', { exact: true }).fill(title)
  await page.getByLabel('Send time (Asia/Kathmandu)').fill('2099-04-05T10:30')
  if (info.project.name.startsWith('mobile'))
    await page.setViewportSize({ width: 320, height: 800 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: `.audit/first-draft-${info.project.name}.png`,
    fullPage: true
  })
  await page.getByRole('button', { name: 'Create draft' }).click()
  await expect(page).toHaveURL(/\/plan\/draft\/[a-f0-9-]+$/)
  const savedUrl = page.url()
  const id = savedUrl.split('/').at(-1)!
  await expect(
    page.getByRole('heading', { name: title, exact: true })
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve date' })).toBeVisible()
  const saved = await db
    .from('campaigns')
    .select('planned_at,calendar_state,copy_state,delivery_state,audience_id')
    .eq('id', id)
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
  // The old campaign address opens the same GROS draft.
  await page.goto(`/campaigns/${id}`)
  await expect(page).toHaveURL(savedUrl)
  await page.reload()
  await expect(
    page.getByRole('heading', { name: title, exact: true })
  ).toBeVisible()
  // The date is approved only with an audience: the command says so.
  await page.getByRole('button', { name: 'Approve date' }).click()
  await expect(page.getByText('Select an audience first')).toBeVisible()
  // The details change on the same page; the send time stays in the
  // store's timezone.
  const renamed = `${title} (renamed)`
  await page.getByLabel('Name', { exact: true }).fill(renamed)
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(
    page.getByRole('heading', { name: renamed, exact: true })
  ).toBeVisible()
  await expect(page.getByLabel('Send time (Asia/Kathmandu)')).toHaveValue(
    '2099-04-05T10:30'
  )
  await page.getByLabel('Add a note').fill('Use the winter photos')
  await page.getByRole('button', { name: 'Save note' }).click()
  await expect(page.getByText('Note saved.')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Use the winter photos')).toBeVisible()
})

test('Use this design on an Inspiration email starts a draft that follows it', async ({
  page
}, info) => {
  test.setTimeout(90_000)
  const db = await newOwner(page)
  await page.goto('/inspiration')
  const domain = sampleDomain('composer')
  await page.getByLabel('Brand website', { exact: true }).fill(domain)
  await page.getByRole('button', { name: 'Follow', exact: true }).click()
  await expect(page.getByText(`Following ${domain}.`)).toBeVisible()
  await runWorkspaceJobs(page)
  await page.goto('/inspiration')
  await page
    .getByRole('region', { name: 'Latest emails' })
    .getByRole('link', { name: 'Use this design' })
    .first()
    .click()
  await expect(page).toHaveURL(
    /\/inspiration\/use\?attempt=[a-f0-9-]+&reference=[a-f0-9-]+$/
  )
  const referenceId = new URL(page.url()).searchParams.get('reference')!
  await expect(
    page.getByRole('heading', { name: 'Use this design', level: 1 })
  ).toBeVisible()
  const frame = page.frameLocator('iframe[title^="The email: "]')
  await expect(frame.locator('body')).not.toBeEmpty()
  expect(await frame.locator('script, form').count()).toBe(0)
  await page.screenshot({
    path: `.audit/first-draft-reference-${info.project.name}.png`,
    fullPage: true
  })
  await page
    .getByLabel('What should this email do?')
    .fill('Adapt the section order using our original brand facts.')
  await page.getByRole('button', { name: 'Create draft' }).click()
  await expect(page).toHaveURL(/\/plan\/draft\/[a-f0-9-]+$/)
  await expect(page.getByText(/^An Inspiration email/)).toBeVisible()
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

  // The old reference page opens the same email on "Use this design".
  await page.goto(`/email-library/${referenceId}`)
  await expect(page).toHaveURL(
    new RegExp(`/inspiration/use\\?.*reference=${referenceId}`)
  )
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
  await page.getByRole('button', { name: 'Create draft' }).click()
  await expect(
    page.getByText(
      'This source is no longer available. Choose another reference or start from scratch.'
    )
  ).toBeVisible()
  await expect(page.getByLabel('What should this email do?')).toHaveValue(
    'Preserve this idea if the selected reference becomes unavailable.'
  )
})

test('staff can open Use this design but cannot create a draft', async ({
  page
}) => {
  await login(page, 'staff')
  await page.goto('/first-draft')
  await expect(page).toHaveURL(/\/inspiration\/use\?attempt=/)
  await expect(page.getByText('Only the owner creates drafts')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create draft' })).toHaveCount(
    0
  )
})

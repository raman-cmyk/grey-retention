import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { login } from './accounts'
import { runWorkspaceJobs } from './jobs'
import { newOwner } from './new-owner'

/**
 * UI-OLDc: the draft form and the draft it saves are GROS screens
 * (`/inspiration/use`, `/plan/draft/<id>`); the old `/first-draft` and
 * `/campaigns/<id>` addresses open them. UI-USE: "Use this design" on a
 * followed brand's email runs Create email on a planned email instead.
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
  // The date is approved only with an audience: the page says the
  // command's real reason, in plain words.
  await page.getByRole('button', { name: 'Approve date' }).click()
  await expect(
    page
      .getByRole('region', { name: 'The draft' })
      .getByText('Choose an audience and a future send time first.')
  ).toBeVisible()
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

test('Use this design runs Create email on a planned email, with the chosen inspiration email', async ({
  page,
  browser
}, info) => {
  test.setTimeout(150_000)
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
  // UI-USE: no draft request key; Create email is idempotent per planned email.
  await expect(page).toHaveURL(/\/inspiration\/use\?reference=[a-f0-9-]+$/)
  const useUrl = page.url()
  const referenceId = new URL(useUrl).searchParams.get('reference')!
  await expect(
    page.getByRole('heading', { name: 'Use this design', level: 1 })
  ).toBeVisible()
  const frame = page.frameLocator('iframe[title^="The email: "]')
  await expect(frame.locator('body')).not.toBeEmpty()
  expect(await frame.locator('script, form').count()).toBe(0)

  // No plan yet: one button plans the next 15 days.
  await expect(page.getByRole('heading', { name: 'No plan yet' })).toBeVisible()
  await page.getByRole('button', { name: 'Plan next 15 days' }).click()
  await expect(page).toHaveURL(/\/plan$/)
  await expect(
    page.getByRole('heading', { name: 'Which offers should we run?' })
  ).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Plan the 15 days' }).click()
  await expect(
    page.getByRole('heading', { name: 'Your next 15 days' })
  ).toBeVisible({ timeout: 30_000 })

  // Back on the chosen email: the planned emails with no email yet.
  await page.goto(useUrl)
  const pick = page.getByRole('region', { name: 'Choose a planned email' })
  await expect(pick.getByRole('radio').first()).toBeChecked()
  // The sample brand's emails are never tagged by the inbox: the page says
  // so before Create email, and Remix is the choice (UI-USE review).
  await expect(
    page.getByText(
      'This email is still being read, so GROS will make the email from scratch.'
    )
  ).toBeVisible()
  await expect(pick.getByLabel('Remix this email')).toBeChecked()
  if (info.project.name.startsWith('mobile'))
    await page.setViewportSize({ width: 320, height: 800 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: `.audit/use-design-${info.project.name}.png`,
    fullPage: true
  })
  await pick.getByRole('button', { name: 'Create email' }).click()
  // The email's own page (its progress), made from the chosen email.
  await expect(page).toHaveURL(/\/plan\/email\/[0-9a-f-]{36}$/, {
    timeout: 30_000
  })
  const buildId = page.url().split('/').at(-1)!
  const saved = await db
    .from('email_builds')
    .select('*')
    .eq('id', buildId)
    .single()
  expect(saved.error).toBeNull()
  expect(saved.data).toMatchObject({
    mode: 'remix',
    reference_id: referenceId
  })
  // The sample brand's emails are not tagged by the inbox: the build says
  // so and makes the email from scratch, never from another email (D16).
  await expect(async () => {
    await page.reload()
    await expect(
      page
        .getByText(/The email you chose in Inspiration cannot be followed/)
        .first()
    ).toBeVisible()
  }).toPass({ timeout: 60_000 })

  // Another workspace's owner cannot use this email.
  const foreign = await browser.newContext()
  const foreignPage = await foreign.newPage()
  await login(foreignPage, 'other')
  await foreignPage.goto(`/inspiration/use?reference=${referenceId}`)
  await expect(foreignPage.getByText('This email is gone')).toBeVisible()
  await expect(
    foreignPage.getByRole('button', { name: 'Create email' })
  ).toHaveCount(0)
  await foreign.close()

  // The old reference page opens the same email on "Use this design".
  await page.goto(`/email-library/${referenceId}`)
  await expect(page).toHaveURL(
    new RegExp(`/inspiration/use\\?reference=${referenceId}$`)
  )
  await expect(
    page.getByRole('region', { name: 'Choose a planned email' })
  ).toBeVisible()
  // Stop following the brand: Create email is refused, and says why.
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
  await page
    .getByRole('region', { name: 'Choose a planned email' })
    .getByRole('button', { name: 'Create email' })
    .click()
  await expect(
    page.getByText(
      'This email is no longer in your Inspiration. Choose another one there.'
    )
  ).toBeVisible()
  await page.reload()
  await expect(page.getByText('This email is gone')).toBeVisible()
})

test('owner approves the date and the sample copy; staff and another workspace cannot', async ({
  page
}, info) => {
  test.setTimeout(120_000)
  // The seed workspace has an audience and an approved brand, which
  // approving a date needs.
  await login(page)
  await page.goto('/inspiration/use')
  const title = `Approved draft ${randomUUID().slice(0, 8)}`
  await page
    .getByLabel('What should this email do?')
    .fill('A fictional, non-discounted update. No invented claims.')
  await page.getByLabel('Name', { exact: true }).fill(title)
  await page
    .getByLabel(/^Send time/)
    .fill(
      info.project.name.startsWith('mobile')
        ? '2099-06-05T10:30'
        : '2099-05-05T10:30'
    )
  await page
    .getByLabel('Audience', { exact: true })
    .selectOption({ label: 'G | Engaged (fixture definition)' })
  await page.getByRole('button', { name: 'Create draft' }).click()
  await expect(page).toHaveURL(/\/plan\/draft\/[a-f0-9-]+$/)
  const url = page.url()

  // The date: approved, and still approved after a reload.
  await page.getByRole('button', { name: 'Approve date' }).click()
  await expect(page.getByText('Date approved.')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Approve date' })).toHaveCount(
    0
  )
  const progress = page.getByRole('region', { name: 'Progress' })
  await expect(progress.getByText('Approved', { exact: true })).toBeVisible()

  // The copy: asked for, written by the sample job, then approved.
  await page.getByRole('button', { name: 'Write copy' }).click()
  await expect(
    page.getByText('The copy is being written. It shows here in a few minutes.')
  ).toBeVisible()
  await runWorkspaceJobs(page, 15)
  await page.reload()
  const copy = page.getByRole('region', { name: 'Copy' })
  await expect(
    copy.getByText('Sample copy, written by the sample writer.')
  ).toBeVisible()
  await expect(copy.getByLabel('Subject', { exact: true })).not.toHaveValue('')
  await copy.getByRole('button', { name: 'Approve copy' }).click()
  await expect(page.getByText('Copy approved.')).toBeVisible()
  await page.reload()
  await expect(copy.getByText('You approved this copy.')).toBeVisible()
  await expect(
    page.getByText('This draft stays here. It does not go to Klaviyo.')
  ).toBeVisible()

  // Staff open the same draft without the owner's buttons.
  await page.context().clearCookies()
  await login(page, 'staff')
  await page.goto(url)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  for (const name of ['Approve date', 'Write copy', 'Approve copy'])
    await expect(page.getByRole('button', { name })).toHaveCount(0)

  // Another workspace's owner gets Not found.
  await page.context().clearCookies()
  await login(page, 'other')
  await page.goto(url)
  await expect(page.getByText('Page not found')).toBeVisible()
  await expect(page.getByRole('heading', { name: title })).toHaveCount(0)
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

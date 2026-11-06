import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { test, expect, type Page } from '@playwright/test'
import { login } from './accounts'
import { newOwner } from './new-owner'

/** A fresh owner with one Staff teammate (added directly, test-only). */
async function ownerWithTeammate(page: Page) {
  const owner = await newOwner(page, { prefix: 'team', name: 'Team studio' })
  const tenant = await owner.from('tenants').select('id').single()
  expect(tenant.error).toBeNull()
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  const email = `team-mate-${randomUUID()}@grey-retention.test`
  const user = await service.auth.admin.createUser({
    email,
    password: randomUUID(),
    email_confirm: true,
    user_metadata: { full_name: 'Sam Teammate' }
  })
  expect(user.error).toBeNull()
  expect(
    (
      await service.from('tenant_memberships').insert({
        tenant_id: tenant.data!.id,
        profile_id: user.data.user!.id,
        role: 'staff',
        status: 'active',
        accepted_at: new Date().toISOString()
      })
    ).error
  ).toBeNull()
  return { email }
}

test('UIR-019 owner invites, resends, cancels, changes a role and deactivates', async ({
  page
}) => {
  const mate = await ownerWithTeammate(page)
  await page.goto('/team')
  await expect(
    page.getByRole('heading', { name: 'Team', level: 1 })
  ).toBeVisible()
  await expect(page).toHaveTitle(/Team/)

  const members = page.getByRole('region', { name: /Members/ })
  await expect(members.getByRole('heading')).toHaveText('Members (2)')
  await expect(
    members.getByRole('listitem').filter({ hasText: '(you)' })
  ).toContainText('Owner')
  const row = members.getByRole('listitem').filter({ hasText: 'Sam Teammate' })
  await expect(row).toContainText(mate.email)

  // Invite: checks first, then saved (nothing is sent).
  const invite = page.getByRole('region', { name: 'Invite a teammate' })
  await invite.getByLabel('Email', { exact: true }).fill('not-an-email')
  await invite.getByRole('button', { name: 'Send invite' }).click()
  await expect(
    invite.getByText('Enter an email address like name@company.com.')
  ).toBeVisible()
  const newcomer = `newcomer-${randomUUID().slice(0, 8)}@example.com`
  await invite.getByLabel('Email', { exact: true }).fill(newcomer)
  await invite.getByLabel('Role', { exact: true }).selectOption('admin')
  await invite.getByRole('button', { name: 'Send invite' }).click()
  await expect(
    invite.getByText(`Invite saved for ${newcomer} as Manager.`, {
      exact: false
    })
  ).toBeVisible()
  await expect(invite.getByText(/no email was sent/)).toBeVisible()
  await invite.getByLabel('Email', { exact: true }).fill(newcomer)
  await invite.getByRole('button', { name: 'Send invite' }).click()
  await expect(invite.getByText(/already has an invite/)).toBeVisible()
  await invite.getByLabel('Email', { exact: true }).fill(mate.email)
  await invite.getByRole('button', { name: 'Send invite' }).click()
  await expect(invite.getByText(/already on the team/)).toBeVisible()

  const pending = page.getByRole('region', { name: /Pending invites/ })
  const invited = pending.getByRole('listitem').filter({ hasText: newcomer })
  await expect(invited).toContainText('Manager · Expires in')
  await invited
    .getByRole('button', { name: `Resend invite to ${newcomer}` })
    .click()
  await expect(pending.getByText(/renewed for 7 more days/)).toBeVisible()
  await invited
    .getByRole('button', { name: `Cancel invite to ${newcomer}` })
    .click()
  await expect(pending.getByText('Invite cancelled.')).toBeVisible()
  await expect(pending.getByText('No pending invites.')).toBeVisible()

  // Role: picking opens nothing; Change role asks first; Cancel saves nothing.
  const role = row.getByLabel('Role for Sam Teammate')
  const changeRole = row.getByRole('button', {
    name: 'Change role for Sam Teammate'
  })
  await expect(changeRole).toBeDisabled()
  await role.selectOption('admin')
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toHaveCount(0)
  await changeRole.click()
  await expect(dialog.getByText('Make Sam Teammate a Manager?')).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await page.reload()
  await expect(
    page
      .getByRole('region', { name: /Members/ })
      .getByLabel('Role for Sam Teammate')
  ).toHaveValue('staff')
  await role.selectOption('admin')
  await changeRole.click()
  await dialog.getByRole('button', { name: 'Change role', exact: true }).click()
  await expect(
    members.getByText('Sam Teammate is now a Manager.')
  ).toBeVisible()
  await page.reload()
  await expect(
    page
      .getByRole('region', { name: /Members/ })
      .getByLabel('Role for Sam Teammate')
  ).toHaveValue('admin')

  // Deactivate after confirming; it stays after a reload; then reactivate.
  const again = page
    .getByRole('region', { name: /Members/ })
    .getByRole('listitem')
    .filter({ hasText: 'Sam Teammate' })
  await again.getByRole('button', { name: 'Deactivate Sam Teammate' }).click()
  await expect(dialog.getByText('Deactivate Sam Teammate?')).toBeVisible()
  await dialog.getByRole('button', { name: 'Deactivate' }).click()
  await expect(page.getByText('Sam Teammate was deactivated.')).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('region', { name: /Members/ }).getByRole('heading')
  ).toHaveText('Members (1) · 1 deactivated')
  await expect(again).toContainText('Deactivated')
  // A deactivated teammate is reactivated, not invited again.
  const invite2 = page.getByRole('region', { name: 'Invite a teammate' })
  await invite2.getByLabel('Email', { exact: true }).fill(mate.email)
  await invite2.getByRole('button', { name: 'Send invite' }).click()
  await expect(invite2.getByText(/Use Reactivate/)).toBeVisible()
  await again.getByRole('button', { name: 'Reactivate Sam Teammate' }).click()
  await dialog.getByRole('button', { name: 'Reactivate' }).click()
  await expect(page.getByText('Sam Teammate was reactivated.')).toBeVisible()

  // Who changed what, after a reload.
  await page.reload()
  const changes = page.getByRole('region', { name: 'Recent team changes' })
  await expect(
    changes.getByText('Sam Teammate was deactivated', { exact: false })
  ).toContainText('by you')
  await expect(
    changes.getByText('Sam Teammate is now a Manager', { exact: false })
  ).toBeVisible()
  await expect(
    changes.getByText(`Invite to ${newcomer} cancelled`, { exact: false })
  ).toBeVisible()
})

test('UIR-019 staff see the team but cannot change it', async ({
  page
}, info) => {
  test.skip(
    info.project.name.startsWith('mobile'),
    'Role check; one layout is enough'
  )
  await login(page, 'staff')
  await page.goto('/team')
  await expect(
    page.getByRole('heading', { name: 'Team', level: 1 })
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Invite a teammate' })
  ).toHaveCount(0)
  await expect(
    page.getByRole('region', { name: /Pending invites/ })
  ).toHaveCount(0)
  const members = page.getByRole('region', { name: /Members/ })
  await expect(members.getByText('Owner', { exact: true })).toBeVisible()
  await expect(members.getByRole('combobox')).toHaveCount(0)
  await expect(members.getByRole('button')).toHaveCount(0)
  await expect(
    members.getByText(
      'Only the owner or a manager can invite people and change access.'
    )
  ).toBeVisible()
})

test('UIR-019 Team fits 375px', async ({ page }, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Sets its own viewport')
  await page.setViewportSize({ width: 375, height: 812 })
  await login(page, 'owner')
  await page.goto('/team')
  await expect(
    page.getByRole('heading', { name: 'Team', level: 1 })
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})

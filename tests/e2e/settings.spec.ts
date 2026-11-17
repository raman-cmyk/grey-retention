import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { login } from './accounts'
import { newOwner, ownerWithTeammate } from './new-owner'

test('UI-SETa the owner sets the biggest discount and adds and removes a code', async ({
  page
}) => {
  await newOwner(page, { prefix: 'settings', name: 'Settings studio' })
  await page.goto('/settings')
  await expect(
    page.getByRole('heading', { name: 'Settings', level: 1 })
  ).toBeVisible()
  await expect(page).toHaveTitle(/Settings/)
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveAttribute(
    'aria-current',
    'page'
  )

  // The timezone is the workspace's, with the store's time now.
  const zone = page.getByRole('region', { name: 'Timezone' })
  await expect(zone.getByText('Asia/Kathmandu (UTC+05:45)')).toBeVisible()
  await expect(zone.locator('time')).toHaveText(
    /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2} \d{4} · \d{1,2}:\d{2} [AP]M$/
  )

  const max = page.getByRole('region', { name: 'Biggest discount' })
  await expect(max).toContainText('Not set')
  await max.getByLabel('Percent off, 0 to 100').fill('120')
  await max.getByRole('button', { name: 'Save biggest discount' }).click()
  await expect(
    max.getByText('Enter a whole number from 0 to 100.')
  ).toBeVisible()
  // A refusal keeps what was typed.
  await expect(max.getByLabel('Percent off, 0 to 100')).toHaveValue('120')
  await max.getByLabel('Percent off, 0 to 100').fill('20')
  await max.getByRole('button', { name: 'Save biggest discount' }).click()
  await expect(
    max.getByText('Saved. New emails offer at most 20% off.')
  ).toBeVisible()
  await page.reload()
  await expect(max.getByText('20%', { exact: true })).toBeVisible()

  const codes = page.getByRole('region', { name: 'Discount codes' })
  await expect(codes.getByText('No codes yet.', { exact: false })).toBeVisible()
  await codes.getByLabel('Code', { exact: true }).fill('WELCOME15')
  await codes.getByLabel('Percent off', { exact: true }).fill('15')
  await codes.getByRole('button', { name: 'Add code' }).click()
  await expect(
    codes.getByText('Added WELCOME15. Agents can use it in new emails.')
  ).toBeVisible()
  const row = codes.getByRole('listitem').filter({ hasText: 'WELCOME15' })
  await expect(row).toContainText('15% off · No end date')
  // The same code again is refused, and the fields keep it.
  await codes.getByLabel('Code', { exact: true }).fill('WELCOME15')
  await codes.getByLabel('Percent off', { exact: true }).fill('15')
  await codes.getByRole('button', { name: 'Add code' }).click()
  await expect(
    codes.getByText('WELCOME15 is already in your list.')
  ).toBeVisible()
  await expect(codes.getByLabel('Code', { exact: true })).toHaveValue(
    'WELCOME15'
  )
  await codes.getByRole('button', { name: 'Remove: WELCOME15' }).click()
  await expect(row).toHaveCount(0)
  // The answer stays though its row has gone.
  await expect(
    codes.getByText('Removed. New emails will not use it.')
  ).toBeVisible()

  // Klaviyo is not connected here; the team and the account link on.
  const klaviyo = page.getByRole('region', { name: 'Klaviyo', exact: true })
  await expect(klaviyo.getByText('Needs you')).toBeVisible()
  await expect(
    klaviyo.getByRole('button', { name: 'Connect Klaviyo' })
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Team' }).getByText('Members')
  ).toBeVisible()
  await page
    .getByRole('region', { name: 'Account' })
    .getByRole('link', { name: 'Change' })
    .click()
  await expect(page).toHaveURL(/\/profile$/)
})

test('UI-SETb the owner invites, resends and cancels on the Team card', async ({
  page
}) => {
  await newOwner(page, { prefix: 'settings-team', name: 'Settings team' })
  await page.goto('/settings')
  const team = page.getByRole('region', { name: 'Team' })
  const me = team.getByRole('list', { name: 'Members' }).getByRole('listitem')
  await expect(me).toHaveCount(1)
  await expect(me).toContainText('(you)')
  await expect(me).toContainText('Owner')
  // Nobody changes their own access.
  await expect(me.getByRole('button')).toHaveCount(0)

  // A refusal stays under Email, which keeps what was typed.
  const email = team.getByLabel('Email', { exact: true })
  await email.fill('not-an-email')
  await team.getByRole('button', { name: 'Invite as Staff' }).click()
  await expect(team.getByRole('alert')).toHaveText(
    'Enter an email address like name@company.com.'
  )
  await expect(email).toHaveAttribute('aria-invalid', 'true')
  await expect(email).toHaveValue('not-an-email')

  const newcomer = `newcomer-${randomUUID().slice(0, 8)}@example.com`
  await email.fill(newcomer)
  await team.getByRole('button', { name: 'Invite as Manager' }).click()
  await expect(
    team.getByText(`Invite saved for ${newcomer} as Manager.`, {
      exact: false
    })
  ).toBeVisible()
  await expect(team.getByText(/no email was sent/)).toBeVisible()
  await expect(email).toHaveValue('')
  const invite = team
    .getByRole('list', { name: 'Pending invites' })
    .getByRole('listitem')
    .filter({ hasText: newcomer })
  await expect(invite).toContainText('Invited as Manager · Expires in')
  await expect(
    team.getByText('Open invites', { exact: true }).locator('..')
  ).toHaveText('Open invites1')
  // A second invite to the same address is refused.
  await email.fill(newcomer)
  await team.getByRole('button', { name: 'Invite as Staff' }).click()
  await expect(team.getByRole('alert')).toContainText('already has an invite')

  await invite.getByRole('button', { name: `Resend: ${newcomer}` }).click()
  await expect(
    team.getByText('Invite renewed for 7 more days. No email was sent.')
  ).toBeVisible()
  await invite
    .getByRole('button', { name: `Cancel invite: ${newcomer}` })
    .click()
  await expect(invite).toHaveCount(0)
  // The answer stays though its row has gone.
  await expect(team.getByText('Invite cancelled.')).toBeVisible()
  await page.reload()
  await expect(team.getByText(newcomer)).toHaveCount(0)
  // Who changed what is still on the old Team page (UI-SETc).
  await team.getByRole('link', { name: 'See team changes' }).click()
  await expect(page).toHaveURL(/\/team$/)
  await expect(
    page
      .getByRole('region', { name: 'Recent team changes' })
      .getByText(`Invite to ${newcomer} cancelled`, { exact: false })
  ).toBeVisible()
})

test('UI-SETb the owner makes a teammate Manager, then Staff, and deactivates and reactivates them', async ({
  page
}) => {
  await ownerWithTeammate(page, { prefix: 'settings-mate', name: 'Mates' })
  await page.goto('/settings')
  const team = page.getByRole('region', { name: 'Team' })
  const row = team
    .getByRole('list', { name: 'Members' })
    .getByRole('listitem')
    .filter({ hasText: 'Sam Teammate' })
  await expect(row).toContainText('· Staff')
  const members = team.getByText('Members', { exact: true }).locator('..')
  await expect(members).toHaveText('Members2')
  // Each change asks first (the browser's confirm), then says what it did.
  const press = async (name: string, answer: string) => {
    page.once('dialog', (dialog) => void dialog.accept())
    await row.getByRole('button', { name }).click()
    await expect(team.getByText(answer)).toBeVisible()
  }
  await press('Make Manager: Sam Teammate', 'Sam Teammate is now a Manager.')
  await expect(row).toContainText('· Manager')
  await press('Make Staff: Sam Teammate', 'Sam Teammate is now Staff.')
  await expect(row).toContainText('· Staff')
  await press('Deactivate: Sam Teammate', 'Sam Teammate was deactivated.')
  await expect(row).toContainText('Deactivated')
  await expect(members).toHaveText('Members1')
  await press('Reactivate: Sam Teammate', 'Sam Teammate was reactivated.')
  await expect(row).not.toContainText('Deactivated')
  await page.reload()
  await expect(row).toContainText('· Staff')
  await expect(
    row.getByRole('button', { name: 'Deactivate: Sam Teammate' })
  ).toBeVisible()
})

test('UI-SETa staff see Settings without the owner’s controls', async ({
  page
}, info) => {
  test.skip(
    info.project.name.startsWith('mobile'),
    'Role check; one layout is enough'
  )
  await login(page, 'staff')
  await page.goto('/settings')
  await expect(
    page.getByRole('heading', { name: 'Settings', level: 1 })
  ).toBeVisible()
  for (const name of [
    'Save biggest discount',
    'Add code',
    'Remove',
    'Connect Klaviyo',
    'Change key',
    'Disconnect',
    'Save timezone',
    // UI-SETb: staff see the team, but no button changes it.
    'Invite as',
    'Resend',
    'Cancel invite',
    'Make Manager',
    'Make Staff',
    'Deactivate',
    'Reactivate'
  ])
    await expect(page.getByRole('button', { name })).toHaveCount(0)
  const team = page.getByRole('region', { name: 'Team' })
  await expect(
    team
      .getByRole('list', { name: 'Members' })
      .getByRole('listitem')
      .filter({ hasText: '(you)' })
  ).toContainText('Staff')
  await expect(team.getByLabel('Email', { exact: true })).toHaveCount(0)
  await expect(
    page.getByText('Only the workspace owner can change Klaviyo.')
  ).toBeVisible()
  await expect(page.getByLabel('Change timezone')).toHaveCount(0)
})

test('UI-SETa Settings fits 375px', async ({ page }, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Sets its own viewport')
  await page.setViewportSize({ width: 375, height: 812 })
  await login(page, 'owner')
  await page.goto('/settings')
  await expect(
    page.getByRole('heading', { name: 'Settings', level: 1 })
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
})

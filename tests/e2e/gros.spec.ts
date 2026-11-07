import { test, expect, type Page } from '@playwright/test'
import { login } from './accounts'

/** On a phone the chat list folds into "Your chats"; open it there. */
async function chatList(page: Page) {
  const fold = page.getByText(/^Your chats \(\d+\)$/)
  if (await fold.isVisible()) {
    const open = await fold.evaluate(
      (el) => (el.parentElement as HTMLDetailsElement).open
    )
    if (!open) await fold.click()
  }
  return page.getByRole('navigation', { name: 'Chats', exact: true })
}

async function ask(page: Page, text: string) {
  const box = page.getByLabel('Message GROS', { exact: true })
  await box.fill(text)
  await box.press('Control+Enter')
  await expect(box).toHaveValue('', { timeout: 15_000 })
}

test('UC-11 Ask GROS: private and shared chats, rename, a confirmed goal change, delete', async ({
  page
}, info) => {
  test.setTimeout(180_000)
  await login(page)
  await page.goto('/gros/new')
  await expect(
    page.getByRole('heading', { name: 'Ask GROS', exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'New private chat', exact: true })
  ).toBeVisible()
  await expect(
    page.getByText(/^Hi .+ — I'm GROS, your marketing assistant\./)
  ).toBeVisible()
  await expect(
    page.getByRole('group', { name: 'Suggested questions' })
  ).toBeVisible()
  // Enter adds a line; only Ctrl+Enter sends (and creates the chat).
  const box = page.getByLabel('Message GROS', { exact: true })
  await box.fill('First line')
  await box.press('Enter')
  await expect(page).toHaveURL(/\/gros\/new$/)
  await expect(box).toHaveValue('First line\n')
  const question = `Original private question ${info.project.name}`
  await ask(page, `First line\n${question}`)
  await expect(page).toHaveURL(/\/gros\/[0-9a-f-]{36}$/)
  const privateUrl = page.url()
  const messages = page.getByRole('list', { name: 'Messages', exact: true })
  await expect(
    messages.getByText(`First line\n${question}`, { exact: true })
  ).toBeVisible()
  await expect(
    messages.getByText('Here is your workspace today.')
  ).toBeVisible()
  await expect(messages.getByText('Last sent:', { exact: true })).toBeVisible()
  await expect(page.getByText('PRIVATE', { exact: true })).toBeVisible()
  await expect(
    (await chatList(page)).locator('a[aria-current="page"]')
  ).toContainText('First line')

  // Rename on Enter; it stays after a reload.
  const privateTitle = `Synthetic private ${info.project.name}`
  const name = page.getByLabel('Chat name', { exact: true })
  await name.fill(privateTitle)
  await name.press('Enter')
  await expect(page.getByText('Renamed.', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Chat name', { exact: true })).toHaveValue(
    privateTitle
  )

  // A question about one campaign.
  const about = page.getByLabel('About', { exact: true })
  const campaign = await about.locator('option').nth(1).getAttribute('value')
  await about.selectOption(campaign!)
  await ask(page, 'Where does this campaign stand?')
  await expect(messages.getByText(/Next step:/).last()).toBeVisible()

  // A second chat, shared, with a goal change the owner applies.
  await page
    .getByRole('link', { name: 'New private chat', exact: true })
    .click()
  await expect(page).toHaveURL(/\/gros\/new$/)
  await ask(page, `Shared chat question ${info.project.name}`)
  await expect(page).toHaveURL(/\/gros\/[0-9a-f-]{36}$/)
  const sharedUrl = page.url()
  const sharedTitle = `Synthetic shared ${info.project.name}`
  await page.getByLabel('Chat name', { exact: true }).fill(sharedTitle)
  await page.getByLabel('Chat name', { exact: true }).press('Enter')
  await expect(page.getByText('Renamed.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Make shared', exact: true }).click()
  const share = page.getByRole('alertdialog', {
    name: 'Share this chat with your team?'
  })
  await expect(share).toContainText('including earlier ones')
  await share.getByRole('button', { name: 'Make shared', exact: true }).click()
  await expect(
    page.getByText('Shared. Your workspace team can read this chat now.')
  ).toBeVisible()
  await expect(page.getByText('SHARED', { exact: true })).toBeVisible()

  const goal = `Original synthetic GROS goal ${info.project.name}`
  await page
    .getByText('Propose a change to a campaign', { exact: true })
    .click()
  await page.getByLabel('Campaign', { exact: true }).selectOption(campaign!)
  await page.getByLabel('Change', { exact: true }).selectOption('edit_goal')
  await page.getByLabel('New goal', { exact: true }).fill(goal)
  await page
    .getByLabel('Why', { exact: true })
    .fill('Propose a new original education goal.')
  await page
    .getByRole('button', { name: 'Propose change', exact: true })
    .click()
  const proposals = page.getByRole('region', { name: 'Proposed changes' })
  const proposal = proposals.getByRole('listitem').filter({ hasText: goal })
  await expect(proposal).toContainText('Waiting for you')
  await proposal
    .getByRole('button', { name: 'Apply change', exact: true })
    .click()
  const apply = page.getByRole('alertdialog', { name: 'Apply this change?' })
  await expect(apply).toContainText(goal)
  await apply.getByRole('button', { name: 'Apply change', exact: true }).click()
  await expect(
    page.getByText('Applied to the campaign.', { exact: true })
  ).toBeVisible()
  await expect(proposal).toContainText('Applied')
  // A second proposal stays the owner's to decide.
  await page
    .getByLabel('New goal', { exact: true })
    .fill('Original pending education goal')
  await page
    .getByLabel('Why', { exact: true })
    .fill('Another proposal must remain mine.')
  await page
    .getByRole('button', { name: 'Propose change', exact: true })
    .click()
  await expect(
    proposals
      .getByRole('listitem')
      .filter({ hasText: 'Original pending education goal' })
  ).toContainText('Waiting for you')

  // Staff: the private chat is closed to them; the shared one is read-only.
  await page.context().clearCookies()
  await login(page, 'staff')
  await page.goto(privateUrl)
  await expect(page.getByText(/This chat isn’t available\./)).toBeVisible()
  await expect(page.getByText(question)).toHaveCount(0)
  await page.goto(sharedUrl)
  await expect(
    page.getByRole('heading', { name: sharedTitle, exact: true })
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Apply change' })).toHaveCount(
    0
  )
  await expect(
    page.getByRole('button', { name: /^(Delete|Make private)$/ })
  ).toHaveCount(0)
  await expect(page.getByLabel('Chat name', { exact: true })).toHaveCount(0)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: `.audit/gros-${info.project.name}.png`,
    fullPage: true
  })

  // Another workspace cannot open it at all.
  await page.context().clearCookies()
  await login(page, 'other')
  await page.goto(sharedUrl)
  await expect(page.getByText(/This chat isn’t available\./)).toBeVisible()

  // The owner deletes the shared chat after confirming.
  await page.context().clearCookies()
  await login(page)
  await page.goto(sharedUrl)
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  const remove = page.getByRole('alertdialog', { name: 'Delete this chat?' })
  await remove.getByRole('button', { name: 'Delete chat', exact: true }).click()
  await expect(page).not.toHaveURL(sharedUrl)
  await page.goto(sharedUrl)
  await expect(page.getByText(/This chat isn’t available\./)).toBeVisible()
})

test('UC-18 team invitation audit, event and support response survive refresh', async ({
  page
}, info) => {
  await login(page)
  await page.goto('/team')
  const email = `synthetic-${info.project.name}-${Date.now()}@grey-retention.test`
  const invite = page.getByRole('region', { name: 'Invite a teammate' })
  await invite.getByLabel('Email', { exact: true }).fill(email)
  await invite.getByRole('button', { name: 'Send invite', exact: true }).click()
  const invitation = page
    .getByRole('region', { name: /Pending invites/ })
    .getByRole('listitem')
    .filter({ hasText: email })
  await expect(invitation).toBeVisible()
  await invitation
    .getByRole('button', { name: `Cancel invite to ${email}`, exact: true })
    .click()
  await expect(invitation).toHaveCount(0)
  await page.reload()
  await expect(
    page.getByRole('region', { name: /Pending invites/ }).getByText(email)
  ).toHaveCount(0)
  // The audit survives the refresh.
  await expect(
    page
      .getByRole('region', { name: 'Recent team changes' })
      .getByText(`Invite to ${email} cancelled`, { exact: false })
  ).toBeVisible()
  await page.goto('/holidays')
  await page
    .getByLabel('Name', { exact: true })
    .fill(`Synthetic event ${info.project.name}`)
  await page.getByLabel('Date', { exact: true }).fill('2027-01-01')
  await page.getByLabel('Type', { exact: true }).selectOption('event')
  await page
    .getByLabel('Notes for the AI strategist (optional)')
    .fill('Original fixture event.')
  await page.getByRole('button', { name: 'Add entry', exact: true }).click()
  await expect(
    page.getByText(`Added “Synthetic event ${info.project.name}”.`)
  ).toBeVisible()
  await expect(
    page.getByText(`Synthetic event ${info.project.name}`, { exact: true })
  ).toBeVisible()
  await page.goto('/support')
  const subject = `Synthetic support ${info.project.name}`
  await page.getByLabel('Ticket subject').fill(subject)
  await page
    .getByLabel('Support message')
    .fill('Original synthetic workflow question.')
  await page
    .getByRole('button', { name: 'Save support request', exact: true })
    .click()
  await expect(
    page.getByRole('heading', {
      name: `${subject} · support · open`,
      exact: true
    })
  ).toBeVisible()
  await page.context().clearCookies()
  await login(page, 'admin')
  await page.goto('/admin/operations')
  const thread = page.locator('article').filter({
    has: page.getByRole('heading', {
      name: `${subject} · support · open`,
      exact: true
    })
  })
  await thread
    .getByLabel('Thread reply')
    .fill('Original operator response; fixture outcome inspected.')
  await thread.getByLabel('Ticket state').selectOption('closed')
  await thread
    .getByRole('button', { name: 'Save thread reply', exact: true })
    .click()
  await expect(
    page.getByRole('heading', {
      name: `${subject} · support · closed`,
      exact: true
    })
  ).toBeVisible()
  await expect(
    page.getByText(`Original private question ${info.project.name}`, {
      exact: true
    })
  ).toHaveCount(0)
  await page.context().clearCookies()
  await login(page)
  await page.goto('/support')
  await expect(
    page
      .getByText('Original operator response; fixture outcome inspected.', {
        exact: true
      })
      .last()
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('heading', {
      name: `${subject} · support · closed`,
      exact: true
    })
  ).toBeVisible()
})

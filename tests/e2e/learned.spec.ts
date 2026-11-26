import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { test, expect, type Page } from '@playwright/test'
import { newOwner } from './new-owner'

/**
 * Fits a phone: no sideways scroll, every control on the page at least
 * 44 px tall and inside the screen's width, and no words cut short.
 */
async function fitsPhone(page: Page) {
  const found = await page.evaluate(() => ({
    sideways: document.documentElement.scrollWidth > innerWidth,
    small: [...document.querySelectorAll<HTMLElement>('a, button, input')]
      .filter((el) => {
        const box = el.getBoundingClientRect()
        if (box.width === 0 || el.closest('.sr-only')) return false
        return box.height < 44 || box.right > innerWidth
      })
      .map((el) => el.textContent?.trim() || el.getAttribute('aria-label')),
    cut: [...document.querySelectorAll<HTMLElement>('main *')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .filter((el) => getComputedStyle(el).textOverflow === 'ellipsis')
      .map((el) => el.textContent)
  }))
  expect(found).toEqual({ sideways: false, small: [], cut: [] })
}

// UI-LRNb: what GROS learned, with the owner's Pin, Unpin and Remove. Each
// test makes its own workspace and writes its rules as the learning worker
// does (service role, on the disposable local stack only: `newOwner`
// refuses any other database first).
const service = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

async function workspaceWithRules(
  page: Page,
  rules: { kind: 'do' | 'dont'; rule: string; source?: string }[]
) {
  const owner = await newOwner(page, {
    prefix: 'learned',
    name: 'Learned studio'
  })
  const tenant = await owner.from('tenants').select('id').single()
  expect(tenant.error).toBeNull()
  return addRules(tenant.data!.id, rules)
}

/** Writes rules as the learning worker does (service role, local only). */
async function addRules(
  tenantId: string,
  rules: { kind: 'do' | 'dont'; rule: string; source?: string }[]
) {
  const admin = service()
  for (const r of rules)
    expect(
      (
        await admin.rpc('add_memory_rule', {
          r: {
            tenantId,
            kind: r.kind,
            rule: r.rule,
            why: 'Seen over 6 sends',
            confidence: 0.8,
            source: r.source ?? 'results',
            idempotencyKey: `e2e-learned:${randomUUID()}`
          }
        })
      ).error
    ).toBeNull()
  return { tenantId, admin }
}

const unique = (words: string) => `${words} ${randomUUID().slice(0, 6)}`

test('UI-LRNb owner pins, unpins and removes what GROS learned, and hears each answer', async ({
  page
}) => {
  const lead = unique('Lead with one product')
  const caps = unique('Avoid all caps in subjects')
  await workspaceWithRules(page, [
    { kind: 'do', rule: lead },
    { kind: 'dont', rule: caps, source: 'inspector' }
  ])
  // Home's card opens Learned.
  await page.goto('/home')
  await page.getByRole('link', { name: 'Open what GROS learned' }).click()
  await expect(page).toHaveURL(/\/learned$/)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Learned' })
  ).toBeVisible()
  const doCard = page.getByRole('region', { name: 'Do', exact: true })
  const avoidCard = page.getByRole('region', { name: 'Avoid', exact: true })
  await expect(doCard).toContainText(lead)
  await expect(doCard).toContainText('From your results')
  await expect(avoidCard).toContainText('From the email checks')
  // #74: this week's report, in plain words.
  await expect(
    page.getByRole('region', { name: 'This week', exact: true })
  ).toContainText("1 new do, 1 new don't.")

  await page.getByRole('button', { name: `Pin: ${lead}`, exact: true }).click()
  await expect(
    page.getByText('Pinned. GROS keeps using this rule.')
  ).toBeVisible()
  await expect(doCard).toContainText('Pinned · From your results')

  await page
    .getByRole('button', { name: `Unpin: ${lead}`, exact: true })
    .click()
  await expect(
    page.getByText('Unpinned. GROS still uses this rule.')
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: `Pin: ${lead}`, exact: true })
  ).toBeVisible()

  await page
    .getByRole('button', { name: `Remove: ${caps}`, exact: true })
    .click()
  await expect(
    page.getByText('Removed. GROS no longer uses this rule.')
  ).toBeVisible()
  await expect(page.getByText(caps)).toHaveCount(0)
  await expect(avoidCard).toContainText('No Avoid rules yet.')

  // Removing the last rule swaps in the empty page; the answer stays.
  await page
    .getByRole('button', { name: `Remove: ${lead}`, exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'No rules in use' })
  ).toBeVisible()
  await expect(
    page.getByText('Removed. GROS no longer uses this rule.')
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open Home' })).toBeVisible()
})

test('UI-LRNb staff see what GROS learned without the owner’s buttons', async ({
  page
}, info) => {
  test.skip(
    info.project.name.startsWith('mobile'),
    'Role check; one layout is enough'
  )
  const rule = unique('Show the price in the subject')
  const { tenantId, admin } = await workspaceWithRules(page, [
    { kind: 'do', rule }
  ])
  const email = `learned-staff-${randomUUID()}@grey-retention.test`
  const password = randomUUID()
  const user = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  })
  expect(user.error).toBeNull()
  expect(
    (
      await admin.from('tenant_memberships').insert({
        tenant_id: tenantId,
        profile_id: user.data.user!.id,
        role: 'staff',
        status: 'active',
        accepted_at: new Date().toISOString()
      })
    ).error
  ).toBeNull()
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/home$/)
  await page.goto('/learned')
  await expect(
    page.getByRole('region', { name: 'Do', exact: true })
  ).toContainText(rule)
  await expect(
    page.getByRole('button', { name: /^(Pin|Unpin|Remove)/ })
  ).toHaveCount(0)
})

test('UI-LRNc on a laptop each rule keeps Pin and Remove on its own line', async ({
  page
}, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Sets its own viewport')
  await page.setViewportSize({ width: 1280, height: 800 })
  const rule = unique('Open with the newest arrival and one clear reason')
  await workspaceWithRules(page, [{ kind: 'do', rule }])
  await page.goto('/learned')
  const words = page
    .getByRole('region', { name: 'Do', exact: true })
    .getByText(rule, { exact: true })
  const remove = page.getByRole('button', {
    name: `Remove: ${rule}`,
    exact: true
  })
  const text = (await words.boundingBox())!
  const button = (await remove.boundingBox())!
  // Beside the rule, not under it (a phone puts it under the words).
  expect(button.x).toBeGreaterThanOrEqual(text.x + text.width)
  expect(button.y).toBeLessThan(text.y + text.height)
  expect(button.y + button.height).toBeGreaterThan(text.y)
})

test('UI-LRNb Learned fits a 375 px phone: no rules yet, then Do and Avoid', async ({
  page
}, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Sets its own viewport')
  await page.setViewportSize({ width: 375, height: 812 })
  const { tenantId } = await workspaceWithRules(page, [])
  // A new store: nothing learned yet, one way on (Home).
  await page.goto('/learned')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Learned' })
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'No rules in use' })
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open Home' })).toBeInViewport()
  await fitsPhone(page)

  await addRules(tenantId, [
    {
      kind: 'do',
      rule: unique(
        'Open with the newest arrival and one clear reason to look today'
      )
    },
    {
      kind: 'dont',
      rule: unique('Never stack two discounts in one email'),
      source: 'seed'
    }
  ])
  await page.goto('/learned')
  await expect(
    page.getByRole('region', { name: 'Avoid', exact: true })
  ).toContainText('From the starting rules')
  // Each rule's words, source and date show whole; its buttons fit.
  await fitsPhone(page)
  const remove = page.getByRole('button', { name: /^Remove: Never stack/ })
  await remove.scrollIntoViewIfNeeded()
  await expect(remove).toBeInViewport()
})

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { login } from './accounts'
test('UC-03/04 shared synthetic capture, safe preview and private evidence playbooks persist', async ({
  page
}, info) => {
  test.setTimeout(90_000)
  const role = info.project.name.startsWith('mobile') ? 'other' : 'owner',
    otherRole = role === 'owner' ? 'other' : 'owner',
    rule = `Private synthetic rule ${info.project.name}`
  await login(page, role)
  await page.goto('/competitor-agent')
  for (const label of ['alpha', 'beta', 'gamma']) {
    await page
      .getByLabel('Fictional capture domain')
      .fill(`synthetic-${label}.example`)
    await page
      .getByLabel('Reference label', { exact: true })
      .fill(`Fixture ${label}`)
    await page.getByLabel('Private workspace rules', { exact: true }).fill(rule)
    await page
      .getByRole('button', { name: 'Save private subscription', exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: `Fixture ${label}`, exact: true })
    ).toBeVisible()
    await page
      .getByRole('button', {
        name: `Queue fixture capture for Fixture ${label}`,
        exact: true
      })
      .click()
    await expect(
      page.getByRole('button', {
        name: `Queue fixture capture for Fixture ${label}`,
        exact: true
      })
    ).toBeEnabled()
  }
  await page.getByRole('button', { name: 'Run reference fixture jobs' }).click()
  await expect(
    page.getByText(
      'Reference job pass completed. Inspect persisted evidence.',
      { exact: true }
    )
  ).toBeVisible()
  await expect(
    page.getByText('10/10 captured emails', { exact: true })
  ).toHaveCount(3)
  const priorBooks = await page
    .getByRole('heading', { name: /^Playbook v/ })
    .count()
  await page.getByRole('button', { name: 'Queue brand playbook' }).click()
  const queuedPlaybook = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Queue brand playbook' }) })
  await expect(
    queuedPlaybook.getByText(
      'Reference fixture intent queued. Run reference jobs to process it.',
      { exact: true }
    )
  ).toBeVisible()
  await page.getByRole('button', { name: 'Run reference fixture jobs' }).click()
  await expect(page.getByRole('heading', { name: /^Playbook v/ })).toHaveCount(
    priorBooks + 1
  )
  await expect(
    page.getByText(/3 complete sources · 30 email evidence records/).first()
  ).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: /^Playbook v/ })).toHaveCount(
    priorBooks + 1
  )
  const card = page.getByRole('article').filter({
    has: page.getByRole('heading', { name: 'Fixture alpha', exact: true })
  })
  await card
    .getByRole('link', { name: 'Profile, sequences and emails' })
    .click()
  await expect(page).toHaveURL(/\/competitor-agent\/[a-f0-9-]+$/)
  const privateUrl = page.url()
  await expect(page.getByText(rule, { exact: true })).toBeVisible()
  await page
    .getByRole('link', {
      name: 'Original fictional reference 1 from synthetic-alpha.example',
      exact: true
    })
    .click()
  await expect(page).toHaveURL(/\/email-library\//, { timeout: 15_000 })
  const frame = page.frameLocator(
    'iframe[title="Synthetic reference email preview"]'
  )
  await expect(
    frame.getByRole('heading', {
      name: 'Original fictional reference 1 from synthetic-alpha.example'
    })
  ).toBeVisible()
  expect(await frame.locator('script, img, form, a').count()).toBe(0)
  expect(await page.locator('iframe').getAttribute('sandbox')).toBe('')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: `.audit/reference-${info.project.name}.png`,
    fullPage: true
  })
  // Browser session plus direct RLS check: another member can reuse safe capture without private rules/playbooks.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
    accounts = JSON.parse(
      readFileSync('.audit/local-accounts.json', 'utf8')
    ) as Record<string, { email: string; password: string }>
  expect(['127.0.0.1', 'localhost']).toContain(new URL(url).hostname)
  const own = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  await own.auth.signInWithPassword(accounts[role]!)
  const ownBooks = await own.from('playbooks').select('id')
  expect(ownBooks.data?.length).toBeGreaterThan(0)
  const other = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  await other.auth.signInWithPassword(accounts[otherRole]!)
  const hidden = await other
    .from('playbooks')
    .select('id')
    .eq('id', ownBooks.data![0]!.id)
  expect(hidden.data).toEqual([])
  await page.context().clearCookies()
  await login(page, otherRole)
  await page.goto(privateUrl)
  await expect(
    page.getByRole('heading', { name: 'Nothing is pinned here.', exact: true })
  ).toBeVisible()
  const hiddenSubscription = await other
    .from('competitor_subscriptions')
    .select('id')
    .eq('id', privateUrl.split('/').at(-1)!)
  expect(hiddenSubscription.data).toEqual([])
  await page.goto('/competitor-agent')
  await expect(page.getByText(rule, { exact: true })).toHaveCount(0)
})

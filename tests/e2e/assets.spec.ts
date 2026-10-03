import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { login } from './accounts'
import { assetZip } from '../helpers/asset-zip'
import { fixtureGraphic } from '../../features/assets/fixture-adapters'
test('UC-01/02 private ZIP intake, replay, classification and owner correction persist', async ({
  page
}, info) => {
  const name = `synthetic-logo-${info.project.name}-${Date.now()}.png`,
    bytes = fixtureGraphic(
      info.project.name.startsWith('mobile') ? 42 : 41,
      name
    )
  const zip = assetZip([
    { name, bytes, deflate: true },
    { name: `alias-${name}`, bytes },
    {
      name: 'unsupported.svg',
      bytes: Buffer.from('<svg><script>hostile()</script></svg>')
    }
  ])
  await login(page)
  await page.goto('/assets')
  await page.getByLabel('Brand image files or one ZIP').setInputFiles({
    name: 'original-synthetic-kit.zip',
    mimeType: 'application/zip',
    buffer: zip
  })
  await page.getByRole('button', { name: 'Import private assets' }).click()
  await expect(
    page.getByText(
      'Import persisted: 1 stored, 1 duplicates, 1 failed. Queue fixture classification; tags require owner review.',
      { exact: true }
    )
  ).toBeVisible()
  await page.getByLabel('Brand image files or one ZIP').setInputFiles({
    name: 'original-synthetic-kit.zip',
    mimeType: 'application/zip',
    buffer: zip
  })
  await page.getByRole('button', { name: 'Import private assets' }).click()
  await expect(
    page.getByText(
      'Import persisted: 0 stored, 2 duplicates, 1 failed. Queue fixture classification; tags require owner review.',
      { exact: true }
    )
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Queue synthetic classification' })
    .click()
  await expect(
    page.getByText(
      'Fixture intent queued. Run queued setup jobs to process it.'
    )
  ).toBeVisible()
  await page.getByRole('button', { name: 'Run queued setup jobs' }).click()
  const card = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
  await expect(
    card.getByText('logo · v2 · fixture', { exact: true })
  ).toBeVisible()
  await card
    .getByLabel(`Category for ${name}`, { exact: true })
    .selectOption('proof')
  await card.getByRole('button', { name: 'Save owner correction' }).click()
  await expect(
    card.getByText('proof · v3 · owner', { exact: true })
  ).toBeVisible()
  await page.reload()
  await expect(
    card.getByText('proof · v3 · owner', { exact: true })
  ).toBeVisible()
  const signedSrc = await card
    .getByRole('img', { name, exact: true })
    .getAttribute('src')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: `.audit/assets-${info.project.name}.png`,
    fullPage: true
  })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
    accounts = JSON.parse(
      readFileSync('.audit/local-accounts.json', 'utf8')
    ) as Record<string, { email: string; password: string }>
  expect(['127.0.0.1', 'localhost']).toContain(new URL(url).hostname)
  const other = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  await other.auth.signInWithPassword(accounts.other!)
  const denied = await other.storage
    .from('brand-assets')
    .createSignedUrl(
      new URL(signedSrc!).pathname.split('/brand-assets/')[1]!,
      60
    )
  expect(denied.error).toBeTruthy()
  expect(denied.data).toBeNull()
  await page.context().clearCookies()
  await login(page, 'other')
  await page.goto('/assets')
  await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0)
})

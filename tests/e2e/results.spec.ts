import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import type { Database } from '@/lib/supabase/database.types'
import { storedRefusal } from '@/features/results/never-overwrite'
import { newOwner } from './new-owner'

test.describe('Results (UI-RES-b)', () => {
  test('a new store has no results yet, and one button to plan', async ({
    page
  }, info) => {
    await newOwner(page, { prefix: 'results', name: 'Results studio' })
    await page.goto('/results')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Results' })
    ).toBeVisible()
    const menuItem = page.getByRole('link', { name: 'Results', exact: true })
    await expect(menuItem).toHaveAttribute('aria-current', 'page')
    await expect(menuItem).toHaveAttribute('href', '/results')
    await expect(
      page.getByRole('heading', { name: 'No results yet' })
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Plan next 15 days' })
    ).toHaveAttribute('href', '/plan')
    // Nothing scrolls sideways.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true)
    if (process.env.RESULTS_SHOT)
      await page.screenshot({
        path: `${process.env.RESULTS_SHOT}/results-${info.project.name}.png`,
        fullPage: true
      })
  })
})

test.describe('PICK-99: never overwrite (the stored state)', () => {
  test('the push guard’s query runs against the local database', async ({
    browserName
  }, info) => {
    void browserName
    test.skip(
      info.project.name !== 'desktop-chromium',
      'one database check is enough'
    )
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    if (
      process.env.GREY_LOCAL_E2E !== '1' ||
      !['localhost', '127.0.0.1'].includes(new URL(url).hostname)
    )
      throw new Error('Disposable local database required.')
    const db = createClient<Database>(
      url,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
    // Its embed (`email_builds!inner`) and filters as PostgREST serves
    // them: an email with no draft read yet is no refusal, and no error.
    expect(
      await storedRefusal(
        db,
        '00000000-0000-4000-8000-000000000101',
        randomUUID()
      )
    ).toBeNull()
  })
})

import { test, expect } from '@playwright/test'
import { login } from './accounts'
test('UC-01/02 fixture Drive and commerce jobs persist real private artifacts and kit evidence', async ({
  page
}, info) => {
  test.setTimeout(90_000)
  await login(page, info.project.name.startsWith('mobile') ? 'other' : 'owner')
  // UI-OLDc moved the sample-data test controls to Assets; UI-BRAND made
  // it the GROS page Brand assets under Settings, the tools in their own
  // cards for the owner (both accounts here are owners).
  await page.goto('/settings/assets')
  // The product fixture is called "sample catalog" (v2 is Klaviyo only).
  for (const provider of ['klaviyo', 'sample catalog', 'drive']) {
    await page
      .getByLabel(`${provider} fixture status`)
      .selectOption('connected')
    await page
      .getByRole('button', { name: `Save ${provider} fixture`, exact: true })
      .click()
    await expect(
      page.getByRole('button', {
        name: `Save ${provider} fixture`,
        exact: true
      })
    ).toBeEnabled()
    if (provider !== 'klaviyo')
      await page
        .getByRole('button', {
          name: `Queue ${provider} sync`,
          exact: true
        })
        .click()
  }
  // The brand kit is on Brand assets too (UI-BRAND).
  await page.goto('/settings/assets')
  await page
    .getByLabel('Brand kit source text')
    .fill(
      `Original supplied color #123abc; font: Inter; revision ${Date.now()}`
    )
  await page
    .getByRole('button', { name: 'Queue fixture kit extraction' })
    .click()
  await expect(
    page.getByText(
      'Fixture intent queued. Run queued setup jobs to process it.',
      { exact: true }
    )
  ).toBeVisible()
  // Other owner intents can share this tenant queue. Bounded passes drain the eligible setup work.
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Run queued setup jobs' }).click()
    await expect(
      page.getByText(
        'Fixture job pass completed. Inspect persisted outcomes.',
        { exact: true }
      )
    ).toBeVisible()
    await page.reload()
  }
  const kit = page.getByRole('region', { name: 'Brand kit', exact: true })
  await expect(kit.getByText('#123abc', { exact: true })).toBeVisible()
  await kit.getByRole('button', { name: /^Approve kit v\d+$/ }).click()
  await expect(
    kit.getByText(/Owner approved this kit version\./).first()
  ).toBeVisible()
  // The sample catalog's products are in Brand's catalog.
  await page.goto('/settings/brand')
  await expect(
    page
      .getByRole('region', { name: 'Catalog', exact: true })
      // The product list (the Stock form's choice repeats the name).
      .getByRole('list', { name: 'Products', exact: true })
      .getByText('Original demo product 1 · Synthetic', { exact: true })
  ).toBeVisible()
  await page.goto('/settings/assets')
  await expect(
    page.getByRole('heading', {
      name: 'synthetic-logo-graphic-0.png',
      exact: true
    })
  ).toBeVisible()
  await expect(
    page.getByRole('img', { name: 'synthetic-logo-graphic-0.png', exact: true })
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Queue synthetic classification' })
    .click()
  await expect(
    page.getByText(
      'Fixture intent queued. Run queued setup jobs to process it.',
      { exact: true }
    )
  ).toBeVisible()
  await page.getByRole('button', { name: 'Run queued setup jobs' }).click()
  await expect(
    page.getByText('Fixture job pass completed. Inspect persisted outcomes.', {
      exact: true
    })
  ).toBeVisible()
  await page.reload()
  const readiness = page.getByRole('region', { name: 'Readiness', exact: true })
  await expect(
    readiness
      .getByRole('listitem')
      .filter({ hasText: 'Classified usable assets' })
  ).toContainText('Done')
  await expect(readiness.getByText('LIVE competitor evidence')).toBeVisible()
  await page.goto('/settings/assets')
  // Only the two sources whose sample sync jobs ran show a sync time;
  // connecting Klaviyo alone never claims one.
  await expect(page.getByText(/Last read /)).toHaveCount(2)
  await page.getByRole('button', { name: 'Queue drive sync' }).click()
  await page.getByRole('button', { name: 'Run queued setup jobs' }).click()
  await page.goto('/settings/assets')
  await expect(
    page.getByRole('heading', { name: /^synthetic-logo-graphic-\d+\.png$/ })
  ).toHaveCount(20)
})

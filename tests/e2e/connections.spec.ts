import { test, expect } from '@playwright/test'
import { login } from './accounts'
test('UC-01/02 fixture Drive and commerce jobs persist real private artifacts and kit evidence', async ({
  page
}, info) => {
  test.setTimeout(90_000)
  await login(page, info.project.name.startsWith('mobile') ? 'other' : 'owner')
  await page.goto('/connections')
  // The sample-data test controls sit in a collapsed section below the cards.
  await page.getByText('Sample data tools', { exact: true }).click()
  for (const provider of ['klaviyo', 'shopify', 'drive']) {
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
          name: `Queue ${provider} fixture sync`,
          exact: true
        })
        .click()
  }
  await page.goto('/brand')
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
  await expect(page.getByText('Colors: #123abc', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^Approve kit v\d+$/ }).click()
  await expect(page.getByText('Owner approved this kit version.')).toBeVisible()
  await expect(
    page.getByRole('heading', {
      name: 'Original demo product 1 · Synthetic',
      exact: true
    })
  ).toBeVisible()
  await page.goto('/assets')
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
  await expect(
    page.getByText('✓ Classified usable assets', { exact: true })
  ).toBeVisible()
  await expect(page.getByText(/LIVE competitor evidence$/)).toBeVisible()
  await page.goto('/connections')
  await page.getByText('Sample data tools', { exact: true }).click()
  // Only the two sources whose sample sync jobs ran show a sync time;
  // connecting Klaviyo alone never claims one.
  await expect(page.getByText(/Last sync: 20/)).toHaveCount(2)
  await page.getByRole('button', { name: 'Queue drive fixture sync' }).click()
  await page.getByRole('button', { name: 'Run queued setup jobs' }).click()
  await page.goto('/assets')
  await expect(
    page.getByRole('heading', { name: /^synthetic-logo-graphic-\d+\.png$/ })
  ).toHaveCount(20)
})

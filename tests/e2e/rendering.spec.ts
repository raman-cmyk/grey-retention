import { test, expect } from '@playwright/test'
import { login } from './accounts'
test('UC-08 original strip artifacts, focused revision, owner approval and mapped assembly persist', async ({
  page
}, info) => {
  test.setTimeout(90_000)
  await login(page, info.project.name.startsWith('mobile') ? 'other' : 'owner')
  await page.goto('/campaign-agent')
  const panel = page.locator('section').filter({
    has: page.getByRole('heading', {
      name: 'Guarded 30-day planning',
      exact: true
    })
  })
  await panel
    .getByRole('link', { name: /Synthetic 1\b/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/campaigns\//)
  await expect(
    page.getByRole('button', {
      name: 'Queue original fixture design',
      exact: true
    })
  ).toBeVisible()
  const renderHeadings = page.getByRole('heading', {
    name: /^Fixture design v/
  })
  const priorHeading = (await renderHeadings.count())
    ? await renderHeadings.first().textContent()
    : null
  const nextRevision = priorHeading
    ? Number(priorHeading.match(/v(\d+)/)![1]) + 2
    : 4
  await page
    .getByRole('button', { name: 'Queue original fixture design', exact: true })
    .click()
  await expect(
    page.getByText(
      'Original fixture render queued. Run campaign fixture jobs.',
      { exact: true }
    )
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Run queued fixture jobs', exact: true })
    .click()
  await expect(
    page.getByRole('heading', {
      name: `Fixture design v${nextRevision - 1} · copy v2`,
      exact: true
    })
  ).toBeVisible()
  await expect(
    page.getByRole('img', {
      name: 'Original synthetic hero strip',
      exact: true
    })
  ).toBeVisible()
  const hero = page.getByRole('img', {
      name: 'Original synthetic hero strip',
      exact: true
    }),
    copy = page.getByRole('img', {
      name: 'Original synthetic copy strip',
      exact: true
    }),
    cta = page.getByRole('img', {
      name: 'Original synthetic cta strip',
      exact: true
    })
  const identity = (value: string) => new URL(value).pathname
  const before = {
    hero: identity((await hero.getAttribute('src'))!),
    copy: identity((await copy.getAttribute('src'))!),
    cta: identity((await cta.getAttribute('src'))!)
  }
  await expect
    .poll(() => hero.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBe(600)
  await page.getByLabel('Fixture strip to revise').selectOption('hero')
  await page
    .getByLabel('Fixture section feedback')
    .fill('Increase hero spacing for the original synthetic strip.')
  await page
    .getByRole('button', {
      name: 'Request fixture strip revision',
      exact: true
    })
    .click()
  await expect(
    page.getByRole('button', {
      name: 'Queue requested strip revision',
      exact: true
    })
  ).toBeVisible()
  await page
    .getByRole('button', {
      name: 'Queue requested strip revision',
      exact: true
    })
    .click()
  await expect(
    page.getByText(
      'Original fixture render queued. Run campaign fixture jobs.',
      { exact: true }
    )
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Run queued fixture jobs', exact: true })
    .click()
  await expect(
    page.getByRole('heading', {
      name: `Fixture design v${nextRevision} · copy v2`,
      exact: true
    })
  ).toBeVisible()
  expect(identity((await hero.getAttribute('src'))!)).not.toBe(before.hero)
  expect(identity((await copy.getAttribute('src'))!)).toBe(before.copy)
  expect(identity((await cta.getAttribute('src'))!)).toBe(before.cta)
  await page
    .getByRole('button', {
      name: 'Review fixture design approval',
      exact: true
    })
    .click()
  await page
    .getByRole('button', {
      name: `Approve exact fixture design v${nextRevision}`,
      exact: true
    })
    .click()
  await expect(
    page.getByText(`Owner approved exact fixture design v${nextRevision}.`, {
      exact: true
    })
  ).toBeVisible()
  await page
    .getByLabel('Footer postal address')
    .fill('42 Original Fictional Road, Synthetic Town')
  await page
    .getByRole('button', {
      name: 'Validate fixture delivery package',
      exact: true
    })
    .click()
  const preview = page.frameLocator('iframe[title="Final email preview"]')
  await expect(
    preview.getByRole('img', { name: 'Owner-approved hero strip', exact: true })
  ).toBeVisible()
  expect(await preview.getByRole('img').count()).toBe(3)
  await expect(
    preview.getByRole('link', { name: 'Unsubscribe', exact: true })
  ).toHaveAttribute('href', /\/unsubscribe$/)
  await expect(
    preview.getByRole('link', { name: 'Privacy', exact: true })
  ).toHaveAttribute('href', /\/privacy$/)
  const mainLink = preview.getByRole('link', {
    name: 'Explore the collection',
    exact: true
  })
  await expect(mainLink).toHaveAttribute(
    'href',
    /utm_source=grey_retention_fixture/
  )
  expect(await page.locator('iframe').getAttribute('sandbox')).toBe('')
  await page.reload()
  await expect(
    page.getByText(`Owner approved exact fixture design v${nextRevision}.`, {
      exact: true
    })
  ).toBeVisible()
  await expect(
    preview.getByRole('link', { name: 'Unsubscribe', exact: true })
  ).toBeVisible()
  await expect
    .poll(() =>
      preview
        .getByRole('img', { name: 'Owner-approved hero strip', exact: true })
        .evaluate((el) => (el as HTMLImageElement).naturalWidth)
    )
    .toBe(600)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({
    path: `.audit/rendering-${info.project.name}.png`,
    fullPage: true
  })
})

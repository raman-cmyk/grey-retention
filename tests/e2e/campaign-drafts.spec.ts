import { expect, test } from '@playwright/test'
import { login } from './accounts'

test('old campaign drafts links land in the Campaigns table (UIR-017)', async ({
  page,
  browser
}) => {
  await login(page)
  await page.goto('/campaign-drafts?status=ready')
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === '/campaign-agent' &&
      url.searchParams.get('view') === 'table' &&
      url.searchParams.get('status') === 'needs_approval'
  )
  await expect(
    page
      .getByRole('navigation', { name: 'Filter by status' })
      .getByRole('link', { name: /^Needs your approval \(\d+\)$/ })
  ).toHaveAttribute('aria-current', 'true')
  await page.goto('/campaign-drafts/new')
  await expect(page).toHaveURL(/\/first-draft/)
  // Signed out, the old link asks for a sign-in first.
  const anonymous = await browser.newPage()
  await anonymous.goto('/campaign-drafts')
  await expect(anonymous).toHaveURL(/\/login$/)
  await anonymous.close()
})

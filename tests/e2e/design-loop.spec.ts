import { expect, test, type Browser } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { login } from './accounts'
async function originalArtifact(
  browser: Browser,
  path: string,
  revised: boolean,
  copy: string
) {
  const proof = await browser.newPage({ viewport: { width: 600, height: 900 } })
  const safe = copy
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
  await proof.setContent(
    `<html><body style="margin:0;background:#f4f1e9;font-family:Arial;color:#222"><main style="padding:${revised ? 56 : 32}px"><p style="font-size:12px;letter-spacing:3px">SYNTHETIC CEDAR LANE</p><h1 style="font-size:48px;margin:40px 0">A considered<br>weekend.</h1><div style="height:180px;background:#d6d8cb;display:flex;align-items:center;justify-content:center">Original synthetic graphic · ${revised ? 'revised hero' : 'initial hero'}</div><p style="white-space:pre-wrap;line-height:1.6">${safe}</p><p style="display:inline-block;background:#222;color:white;padding:16px">Explore the collection</p><footer style="font-size:12px;margin-top:32px">Fictional demo · original browser-rendered artifact</footer></main></body></html>`
  )
  await proof.screenshot({ path, fullPage: true })
  await proof.close()
}
test('UC-06/07/09/10 owner-designer revision loop, exact approvals, simulated scheduling and cancellation persist', async ({
  page,
  browser
}, testInfo) => {
  test.setTimeout(90_000)
  await login(page)
  await page.goto('/campaign-agent')
  const title = `Synthetic design loop ${testInfo.project.name} ${Date.now()}`
  await page.getByLabel('Campaign title').fill(title)
  await page
    .getByLabel(/^Send time/)
    .fill(
      new Date(
        Date.now() +
          (testInfo.project.name.startsWith('mobile') ? 45 : 7) * 86400000
      ).toISOString()
    )
  await page
    .getByLabel('Goal and approved facts')
    .fill(
      'Original fictional collection note; no discount or invented urgency.'
    )
  await page
    .getByLabel('Audience', { exact: true })
    .selectOption({ label: 'G | Engaged (fixture definition)' })
  await page
    .getByRole('button', { name: 'Create campaign', exact: true })
    .click()
  await expect(page).toHaveURL(/\/campaigns\//)
  const campaignUrl = page.url()
  await page.getByRole('button', { name: 'Approve calendar v1' }).click()
  await expect(
    page.getByRole('button', { name: 'Approve calendar v1' })
  ).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Queue original fixture copy' })
    .click()
  await expect(page.getByText('copy.generate', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Run queued fixture jobs' }).click()
  await expect(
    page.getByRole('button', { name: 'Approve copy v2' })
  ).toBeVisible()
  const body = await page.getByLabel('Approved copy body').inputValue()
  mkdirSync('.audit', { recursive: true })
  const first = `.audit/design-${testInfo.project.name}-first.png`
  const second = `.audit/design-${testInfo.project.name}-revised.png`
  await originalArtifact(browser, first, false, body)
  await originalArtifact(browser, second, true, body)
  await page.getByRole('button', { name: 'Approve copy v2' }).click()
  await expect(
    page.getByRole('button', { name: 'Approve copy v2' })
  ).toHaveCount(0)
  await page.context().clearCookies()
  await login(page, 'admin')
  await page.goto('/admin/designers')
  const row = page
    .getByRole('row')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
  await row
    .getByLabel(`Designer for ${title}`)
    .selectOption({ label: 'Demo Designer' })
  await row
    .getByRole('button', { name: 'Assign approved brief', exact: true })
    .click()
  await expect(
    row.getByRole('button', { name: 'Reassign approved brief' })
  ).toBeVisible()
  const issue = page.locator('article').filter({
    has: page.getByRole('heading', {
      name: `${title} · escalation none`,
      exact: true
    })
  })
  await issue
    .getByLabel('Escalation reason')
    .fill(
      'Original synthetic workflow blocked; admin is coordinating the designer.'
    )
  await issue
    .getByRole('button', { name: 'Record design issue', exact: true })
    .click()
  await page.reload()
  const openIssue = page.locator('article').filter({
    has: page.getByRole('heading', {
      name: `${title} · escalation open`,
      exact: true
    })
  })
  await expect(openIssue).toContainText(
    'Original synthetic workflow blocked; admin is coordinating the designer.'
  )
  await openIssue
    .getByLabel('Administrative resolution')
    .fill('The assigned designer is available; owner review remains required.')
  await openIssue
    .getByRole('button', { name: 'Resolve design issue', exact: true })
    .click()
  await expect(
    page.getByRole('heading', {
      name: `${title} · escalation resolved`,
      exact: true
    })
  ).toBeVisible()
  await page.context().clearCookies()
  await login(page, 'designer')
  await page.getByRole('link', { name: new RegExp(title) }).click()
  await expect(page).toHaveURL(/\/designer\/assignments\//)
  const assignmentUrl = page.url()
  await page.getByLabel('Design image').setInputFiles(first)
  await page
    .getByLabel('Submission notes')
    .fill('Original synthetic first submission.')
  await page.getByRole('button', { name: 'Submit design version' }).click()
  await expect(
    page.getByRole('heading', { name: 'Design v4 · copy v2' })
  ).toBeVisible()
  await page.context().clearCookies()
  await login(page)
  await page.goto(campaignUrl)
  await expect(
    page.getByRole('img', { name: 'Submitted campaign design version 4' })
  ).toBeVisible()
  await page.getByLabel('Design section').fill('Hero')
  await page
    .getByLabel('Requested revision')
    .fill('Increase hero breathing room and retain approved copy.')
  await page.getByRole('button', { name: 'Request section revision' }).click()
  await expect(
    page.getByRole('button', { name: 'Approve design v4' })
  ).toHaveCount(0)
  await page.context().clearCookies()
  await login(page, 'designer')
  await page.goto(assignmentUrl)
  await expect(
    page.getByText('Increase hero breathing room and retain approved copy.', {
      exact: true
    })
  ).toBeVisible()
  await page.getByLabel('Design image').setInputFiles(second)
  await page
    .getByLabel('Submission notes')
    .fill('Original synthetic revised submission.')
  await page.getByRole('button', { name: 'Submit design version' }).click()
  await expect(
    page.getByRole('heading', { name: 'Design v5 · copy v2' })
  ).toBeVisible()
  await page.context().clearCookies()
  await login(page)
  await page.goto(campaignUrl)
  const signedSrc = await page
    .getByRole('img', { name: 'Submitted campaign design version 5' })
    .getAttribute('src')
  await page.getByRole('button', { name: 'Approve design v5' }).click()
  await expect(
    page.getByText('Brand owner approved exact design v5.')
  ).toBeVisible()
  await page
    .getByLabel('Footer postal address')
    .fill('42 Fictional Lane, Demo Town')
  await page
    .getByRole('button', { name: 'Validate fixture delivery package' })
    .click()
  await expect(
    page.getByRole('heading', { name: /Final delivery preview · package v8/ })
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Review scheduling confirmation' })
    .click()
  await expect(
    page.getByRole('dialog', { name: 'Confirm simulated scheduling' })
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('dialog', { name: 'Confirm simulated scheduling' })
  ).not.toBeVisible()
  await page
    .getByRole('button', { name: 'Review scheduling confirmation' })
    .click()
  await page
    .getByRole('dialog', { name: 'Confirm simulated scheduling' })
    .getByRole('button', { name: 'Confirm package v8 scheduling' })
    .click()
  await expect(
    page.getByRole('dialog', { name: 'Confirm simulated scheduling' })
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Run queued fixture jobs' }).click()
  await expect(
    page.getByRole('button', { name: 'Review cancellation' })
  ).toBeVisible()
  await expect(
    page
      .frameLocator('iframe[title="Final email preview"]')
      .getByRole('heading')
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: `.audit/delivery-${testInfo.project.name}.png`,
    fullPage: true
  })
  await page.getByRole('button', { name: 'Review cancellation' }).click()
  const cancel = page.getByRole('dialog', {
    name: 'Confirm cancellation request'
  })
  await cancel
    .getByRole('button', { name: 'Request simulated cancellation' })
    .click()
  await expect(
    cancel.getByText(
      'Intent queued. Run fixture jobs to obtain a confirmed outcome.'
    )
  ).toBeVisible()
  await cancel.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Run queued fixture jobs' }).click()
  await expect(
    page.getByRole('definition').filter({ hasText: /^Cancelled$/ })
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('definition').filter({ hasText: /^Cancelled$/ })
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Review cancellation' })
  ).toHaveCount(0)
  // Real Storage RLS negative check using the other synthetic tenant session; never log the signed token.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  expect(['127.0.0.1', 'localhost']).toContain(new URL(url).hostname)
  const accounts = JSON.parse(
    readFileSync('.audit/local-accounts.json', 'utf8')
  ) as Record<string, { email: string; password: string }>
  const other = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const signedPath = new URL(signedSrc!).pathname.split(
    '/designer-submissions/'
  )[1]!
  await other.auth.signInWithPassword(accounts.other!)
  const denied = await other.storage
    .from('designer-submissions')
    .createSignedUrl(signedPath, 60)
  expect(denied.error).toBeTruthy()
  expect(denied.data).toBeNull()
})

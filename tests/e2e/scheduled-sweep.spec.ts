import { randomInt, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { test, expect, type APIRequestContext } from '@playwright/test'
import { login } from './accounts'
import { run as takeScreenshots } from '../../scripts/inbox-screenshots.mjs'

// Own Playwright project that depends on the desktop and mobile journeys:
// the sweep is global, so it must not drain jobs that other journeys leave
// queued for their own buttons.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const options = { auth: { persistSession: false, autoRefreshToken: false } }

function requireLocal() {
  if (
    process.env.GREY_LOCAL_E2E !== '1' ||
    !['localhost', '127.0.0.1'].includes(new URL(url).hostname)
  )
    throw new Error('Disposable local database required.')
}

async function signIn(email: string, password: string) {
  const db = createClient(url, anon, options)
  expect(
    (await db.auth.signInWithPassword({ email, password })).error
  ).toBeNull()
  const context = await db.rpc('resolve_client_context')
  expect(context.error).toBeNull()
  return { db, tenant: context.data[0].tenant_id as string }
}

async function queueCopy({
  db,
  tenant
}: {
  db: SupabaseClient
  tenant: string
}) {
  const audience = await db
    .from('audiences')
    .select('id')
    .eq('tenant_id', tenant)
    .limit(1)
    .single()
  expect(audience.error).toBeNull()
  const saved = await db.rpc('save_campaign', {
    t: tenant,
    input: {
      title: `Scheduled sweep proof ${randomUUID()}`,
      goal: 'Original synthetic scheduler evidence. No offer or factual claim.',
      // Each proof campaign in its own far-future week, so retries never
      // hit the workspace's weekly send cap (5 per audience).
      planned_at: new Date(
        Date.now() + (400 + 7 * randomInt(0, 300)) * 86400000
      ).toISOString(),
      channel: 'email_text',
      audience_id: audience.data!.id,
      reference_notes: ''
    }
  })
  expect(saved.error).toBeNull()
  const campaign = saved.data as string
  const approved = await db.rpc('approve_calendar', {
    t: tenant,
    target_id: campaign,
    expected_revision: 1
  })
  expect(approved.error).toBeNull()
  const job = await db.rpc('enqueue_copy', {
    t: tenant,
    campaign,
    expected_revision: 1
  })
  expect(job.error).toBeNull()
  return { campaign, job: job.data as string }
}

const sweep = (request: APIRequestContext, authorization?: string) =>
  request.get('/api/internal/jobs', {
    headers: authorization ? { authorization } : {}
  })

const localSecret = () => readFileSync('.audit/local-cron-secret.txt', 'utf8')
const localAccounts = () =>
  JSON.parse(readFileSync('.audit/local-accounts.json', 'utf8')) as Record<
    string,
    { email: string; password: string }
  >
const serviceClient = () =>
  createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options)

// INB-002: before the first sweep ever reads the sample inbox, a platform
// admin registers the sample brand northwind.example (+alias "northwind")
// and the owner follows it, so its sample newsletter lands in Inspiration.
test.beforeAll(async () => {
  requireLocal()
  const accounts = localAccounts()
  const admin = createClient(url, anon, options)
  expect(
    (
      await admin.auth.signInWithPassword({
        email: accounts.admin!.email,
        password: accounts.admin!.password
      })
    ).error
  ).toBeNull()
  const owner = await signIn(accounts.owner!.email, accounts.owner!.password)
  expect(
    (
      await owner.db.rpc('subscribe_competitor', {
        t: owner.tenant,
        domain: 'northwind.example'
      })
    ).error
  ).toBeNull()
  expect(
    (
      await admin.rpc('admin_save_inbox_brand', {
        brand_domain: 'northwind.example',
        alias: 'northwind',
        name: 'Northwind Outdoor',
        brand_niche: 'apparel'
      })
    ).error
  ).toBeNull()
})

/** Finishes work left by earlier journeys so this test's jobs are next in line. */
async function drain(request: APIRequestContext, secret: string) {
  for (let n = 0; n < 20; n++) {
    const response = await sweep(request, `Bearer ${secret}`)
    expect(response.status()).toBe(200)
    if ((await response.json()).processed === 0) return
  }
  throw new Error('The queue did not drain within 20 sweeps.')
}

test('STAB-001 scheduled sweep finishes queued work once per job across workspaces', async ({
  request
}) => {
  requireLocal()
  const admin = serviceClient()
  const accounts = localAccounts()
  const secret = localSecret()

  // Unauthorized calls never run anything.
  expect((await sweep(request)).status()).toBe(401)
  expect((await sweep(request, 'Bearer not-the-secret')).status()).toBe(401)
  expect((await sweep(request, `Basic ${secret}`)).status()).toBe(401)

  // Two real workspaces with queued copy jobs.
  const owner = await signIn(accounts.owner!.email, accounts.owner!.password)
  const other = await signIn(accounts.other!.email, accounts.other!.password)
  expect(owner.tenant).not.toBe(other.tenant)
  await drain(request, secret)
  const jobs = [
    await queueCopy(owner),
    await queueCopy(owner),
    await queueCopy(other)
  ]

  // A paused workspace keeps its queued work untouched.
  const email = `sweep-${randomUUID()}@grey-retention.test`,
    password = randomUUID()
  expect(
    (
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      })
    ).error
  ).toBeNull()
  const paused = createClient(url, anon, options)
  expect(
    (await paused.auth.signInWithPassword({ email, password })).error
  ).toBeNull()
  const created = await paused.rpc('create_tenant_workspace', {
    workspace_name: 'Paused sweep studio',
    workspace_slug: `paused-sweep-${randomUUID()}`,
    workspace_timezone: 'Asia/Kathmandu'
  })
  expect(created.error).toBeNull()
  const pausedTenant = (await paused.rpc('resolve_client_context')).data[0]
    .tenant_id as string
  expect(
    (await paused.rpc('enqueue_health_check', { t: pausedTenant })).error
  ).toBeNull()
  expect(
    (
      await admin
        .from('tenants')
        .update({ status: 'paused' })
        .eq('id', pausedTenant)
    ).error
  ).toBeNull()

  // Vercel cron and GitHub Actions may overlap: three sweeps at once.
  const responses = await Promise.all(
    [1, 2, 3].map(() => sweep(request, `Bearer ${secret}`))
  )
  const inboxStates: string[] = []
  for (const response of responses) {
    expect(response.status()).toBe(200)
    expect(response.headers()['cache-control']).toBe('no-store')
    const body = await response.json()
    expect(body).toMatchObject({ live: false, failed: 0 })
    expect(Object.keys(body).sort()).toEqual(
      [
        'deferred',
        'failed',
        'inbox',
        'live',
        // STR-003 part 2: "Plan next 15 days" steps run in each sweep.
        'plans',
        'processed',
        'rounds',
        'tenants'
      ].sort()
    )
    expect(body.plans).toEqual({ ran: expect.any(Number) })
    // INB-001: each sweep reads the sample inbox first; of three at once,
    // the ones that find a poll already running say so.
    expect(body.inbox).toMatchObject({
      transport: 'fake',
      ready: true,
      synthetic: true
    })
    expect(['done', 'busy']).toContain(body.inbox.run.state)
    inboxStates.push(body.inbox.run.state)
  }
  expect(inboxStates).toContain('done')

  for (const { job, campaign } of jobs) {
    const [run, content] = await Promise.all([
      admin.from('job_runs').select('status,attempt').eq('id', job).single(),
      admin
        .from('campaign_content')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaign)
        .eq('revision', 2)
    ])
    expect(run.data).toEqual({ status: 'succeeded', attempt: 1 })
    expect(content.count).toBe(1)
  }
  const pausedJobs = await admin
    .from('job_runs')
    .select('status,attempt')
    .eq('tenant_id', pausedTenant)
  expect(pausedJobs.data).toEqual([{ status: 'queued', attempt: 0 }])

  // A repeat run is a no-op for finished jobs.
  expect((await sweep(request, `Bearer ${secret}`)).status()).toBe(200)
  for (const { job } of jobs)
    expect(
      (await admin.from('job_runs').select('attempt').eq('id', job).single())
        .data
    ).toEqual({ attempt: 1 })
})

test('STAB-001 scheduled sweep retries failed jobs and recovers crashed workers', async ({
  request
}) => {
  requireLocal()
  const admin = serviceClient()
  const accounts = localAccounts()
  const secret = localSecret()
  const owner = await signIn(accounts.owner!.email, accounts.owner!.password)
  await drain(request, secret)
  const retried = await queueCopy(owner),
    crashed = await queueCopy(owner),
    exhausted = await queueCopy(owner)
  const past = new Date(Date.now() - 60_000).toISOString()
  const setJob = async (id: string, values: Record<string, unknown>) =>
    expect(
      (await admin.from('job_runs').update(values).eq('id', id)).error
    ).toBeNull()
  // Attempt 1 failed with a temporary error, and its back-off has passed.
  await setJob(retried.job, {
    status: 'retry_wait',
    attempt: 1,
    failure_class: 'transient',
    error_code: 'fixture_transient',
    available_at: past
  })
  // A worker stopped in the middle of attempt 1; its lease has expired.
  await setJob(crashed.job, {
    status: 'running',
    attempt: 1,
    lease_token: randomUUID(),
    lease_until: past
  })
  // The fourth and last attempt stopped the same way: no fifth try.
  await setJob(exhausted.job, {
    status: 'running',
    attempt: 4,
    lease_token: randomUUID(),
    lease_until: past
  })

  const response = await sweep(request, `Bearer ${secret}`)
  expect(response.status()).toBe(200)
  expect(await response.json()).toMatchObject({ failed: 0 })

  const state = async ({
    job,
    campaign
  }: {
    job: string
    campaign: string
  }) => {
    const [run, content] = await Promise.all([
      admin
        .from('job_runs')
        .select('status,attempt,error_code')
        .eq('id', job)
        .single(),
      admin
        .from('campaign_content')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaign)
        .eq('revision', 2)
    ])
    return { ...run.data, versions: content.count }
  }
  expect(await state(retried)).toMatchObject({
    status: 'succeeded',
    attempt: 2,
    versions: 1
  })
  expect(await state(crashed)).toMatchObject({
    status: 'succeeded',
    attempt: 2,
    versions: 1
  })
  expect(await state(exhausted)).toEqual({
    status: 'failed',
    attempt: 4,
    error_code: 'stale_lease',
    versions: 0
  })
})

test('INB-002 a sample inbox email keeps its images and its 600px screenshot shows in Inspiration', async ({
  request,
  browser,
  page,
  baseURL
}) => {
  requireLocal()
  const secret = localSecret()
  const admin = serviceClient()
  // The sweeps above read the sample inbox and kept the images; one more
  // sweep finishes anything still waiting.
  expect((await sweep(request, `Bearer ${secret}`)).status()).toBe(200)
  const message = await admin
    .from('inbox_messages')
    .select('id,state,assets_state,images_stored,images_failed')
    .eq('alias_slug', 'northwind')
    .single()
  expect(message.error).toBeNull()
  expect(message.data).toMatchObject({
    state: 'assigned',
    assets_state: 'done',
    images_stored: 1,
    images_failed: 0
  })

  // The screenshot browser (the scheduled GitHub Actions job) photographs it
  // (on a retry, the first attempt already did).
  const before = await admin
    .from('inbox_messages')
    .select('screenshot_path')
    .eq('id', message.data!.id)
    .single()
  const counts = await takeScreenshots({
    base: baseURL!,
    secret,
    browser,
    log: () => {}
  })
  expect(counts.taken).toBeGreaterThanOrEqual(
    before.data?.screenshot_path ? 0 : 1
  )
  expect(counts.failed).toBe(0)
  const shot = await admin
    .from('inbox_messages')
    .select('screenshot_path,screenshot_width,screenshot_height')
    .eq('id', message.data!.id)
    .single()
  expect(shot.data).toMatchObject({
    screenshot_path: `shot/${message.data!.id}.jpg`
  })
  // Rendered at 600px; the page's default margin can add a few pixels.
  expect(shot.data!.screenshot_width).toBeGreaterThanOrEqual(600)
  expect(shot.data!.screenshot_width).toBeLessThan(640)
  // A second run finds nothing left: each email is photographed once.
  expect(
    await takeScreenshots({ base: baseURL!, secret, browser, log: () => {} })
  ).toEqual({ taken: 0, failed: 0 })

  // The owner, who follows northwind.example, sees the picture in Inspiration.
  await login(page, 'owner')
  await page.goto('/library/inspirations')
  const card = page.getByAltText('Screenshot of Spring layers are here')
  await expect(card).toBeVisible()
  // The picture loads lazily, once on screen; its real size is the stored one.
  await card.scrollIntoViewIfNeeded()
  await expect
    .poll(() =>
      card.evaluate((img) => {
        const picture = img as HTMLImageElement
        return picture.complete ? picture.naturalWidth : 0
      })
    )
    .toBe(shot.data!.screenshot_width)

  // INB-003 and CI-001: the next sweep tags the email once: each section
  // with its family, layout and purpose, the email with its labels (the
  // brand's niche gives the industry), and its facts.
  expect((await sweep(request, `Bearer ${secret}`)).status()).toBe(200)
  const labelled = await admin
    .from('inbox_messages')
    .select('labelled_at,extraction_version,facts,industry,labels_state')
    .eq('id', message.data!.id)
    .single()
  expect(labelled.data).toMatchObject({
    extraction_version: 2,
    facts: { subject: 'Spring layers are here', version: 2 }
  })
  expect(['tagged', 'untagged']).toContain(labelled.data!.labels_state)
  const sections = await admin
    .from('email_sections')
    .select(
      'ordinal,block_type,label_source,image_path,tag_state,layout,purpose'
    )
    .eq('inbox_message_id', message.data!.id)
    .order('ordinal')
  expect(sections.data!.length).toBeGreaterThan(0)
  for (const s of sections.data!) {
    expect(s.label_source).toBe('sample')
    expect(s.image_path).toBe(`sect/${message.data!.id}/${s.ordinal}.jpg`)
    // Tagged with every label, or untagged with none.
    if (s.tag_state === 'tagged') expect(s.layout && s.purpose).toBeTruthy()
    else
      expect([s.tag_state, s.block_type, s.layout]).toEqual([
        'untagged',
        'unsure',
        null
      ])
  }
  expect(sections.data!.some((s) => s.tag_state === 'tagged')).toBe(true)

  // CI-002: the sweep after that places each tagged section in the block
  // library, structure only (a new variant, or evidence for one already
  // there), and a workspace member finds it by the email's labels.
  expect((await sweep(request, `Bearer ${secret}`)).status()).toBe(200)
  const placed = await admin
    .from('email_sections')
    .select('tag_state,variant_state,variant_id')
    .eq('inbox_message_id', message.data!.id)
  for (const s of placed.data!)
    if (s.tag_state === 'tagged')
      expect(['made', 'matched', 'no_structure', 'unusable']).toContain(
        s.variant_state
      )
    else expect(s.variant_state).toBeNull()
  const variantIds = placed.data!.flatMap((s) =>
    s.variant_id ? [s.variant_id] : []
  )
  expect(variantIds.length).toBeGreaterThan(0)
  const member = localAccounts()
  const owner = await signIn(member.owner!.email, member.owner!.password)
  const families = await owner.db.rpc('search_block_variants', {
    filters: {},
    max_results: 100
  })
  expect(families.error).toBeNull()
  const library = families.data as { id: string; key: string; spec: unknown }[]
  expect(library.map((v) => v.id)).toEqual(
    expect.arrayContaining([...new Set(variantIds)])
  )
  // Never a competitor's words, links or pictures.
  for (const v of library)
    expect(JSON.stringify(v.spec)).not.toMatch(/https?:|Spring layers/)
  // By the email's labels, a member only finds structures 3 brands sent:
  // never this one brand's email. The agents (service role) find it.
  if (labelled.data!.industry) {
    const filters = { industry: labelled.data!.industry }
    const mine = await owner.db.rpc('search_block_variants', {
      filters,
      max_results: 100
    })
    expect(mine.data).toEqual([])
    const agents = await admin.rpc('search_block_variants', {
      filters,
      max_results: 100
    })
    expect((agents.data as { id: string }[]).map((v) => v.id)).toEqual(
      expect.arrayContaining([...new Set(variantIds)])
    )
  }

  // The sample newsletter was sent a few days ago, so its brand summary
  // (the last 90 days) shows it.
  await page.reload()
  const summary = page.getByRole('list', { name: 'Brand summaries' })
  await expect(
    summary.getByRole('heading', { name: 'northwind.example' })
  ).toBeVisible()
  await expect(summary.getByText(/in the last 90 days/)).toBeVisible()
  await expect(summary.getByText('Sample')).toBeVisible()

  // Another workspace cannot read it.
  const accounts = localAccounts()
  const other = await signIn(accounts.other!.email, accounts.other!.password)
  const denied = await other.db.storage
    .from('inbox-assets')
    .createSignedUrl(shot.data!.screenshot_path!, 60)
  expect(denied.data).toBeNull()
})

test('INB-004 an admin works the inbox queue and keeps the brand directory', async ({
  request,
  browser,
  page
}) => {
  requireLocal()
  // The sweeps above read the sample inbox: Cedar Lane's newsletter came
  // without a +alias, from a sender nobody registered.
  expect((await sweep(request, `Bearer ${localSecret()}`)).status()).toBe(200)

  // A workspace owner never reaches the admin page.
  await login(page, 'owner')
  await page.goto('/admin/inbox')
  await expect(page).toHaveURL(/\/admin\/login/)

  const adminPage = await browser.newPage()
  await login(adminPage, 'admin')
  await adminPage.goto('/admin/inbox')
  await expect(
    adminPage.getByRole('heading', { name: 'Inspiration inbox' })
  ).toBeVisible()
  const queue = adminPage.getByRole('list', { name: 'Inbox tasks' })
  const unknown = queue.getByRole('listitem').filter({
    hasText: 'Email from an unknown sender: news.cedar-lane.example'
  })
  // A retry finds what an earlier attempt already did.
  const db = serviceClient()
  const added = await db
    .from('competitor_captures')
    .select('id')
    .eq('alias_slug', 'cedar')
    .maybeSingle()
  const assigned = await db
    .from('competitor_sender_domains')
    .select('capture_id')
    .eq('domain', 'news.cedar-lane.example')
    .maybeSingle()
  expect(added.error ?? assigned.error).toBeNull()
  if (!assigned.data) await expect(unknown).toBeVisible()

  // The directory gives each brand the address to subscribe with.
  const directory = adminPage.getByRole('table', { name: 'Competitor brands' })
  const northwind = directory
    .getByRole('row')
    .filter({ hasText: 'northwind.example' })
  await expect(northwind).toContainText('capture+northwind@inbox.example')
  await expect(northwind).toContainText('Sample')

  // Add the brand, then give it the unknown sender.
  if (!added.data) {
    await adminPage.getByLabel('Brand name').fill('Cedar Lane')
    await adminPage.getByLabel('Website domain').fill('cedar-lane.example')
    await adminPage.getByLabel("+alias (the brand's short name)").fill('cedar')
    await adminPage.getByLabel('Niche').fill('home')
    await adminPage.getByRole('button', { name: 'Save brand' }).click()
    await expect(adminPage.getByText('Saved Cedar Lane.')).toBeVisible()
    await adminPage.reload()
  }
  if (!assigned.data) {
    await unknown
      .getByLabel('Brand for news.cedar-lane.example')
      .selectOption({ label: 'Cedar Lane (cedar-lane.example)' })
    await unknown.getByRole('button', { name: 'Assign to this brand' }).click()
  }
  // The task is done, so it leaves the queue; the brand now has the email
  // and remembers the sender.
  await expect(unknown).toHaveCount(0)
  const cedar = directory
    .getByRole('row')
    .filter({ hasText: 'cedar-lane.example' })
  await expect(cedar).toContainText('capture+cedar@inbox.example')
  await expect(cedar).toContainText('news.cedar-lane.example')
  await adminPage.close()
})

test('ONB-101 the owner starts a site read and the readers run stores what the sample site says', async ({
  request
}) => {
  requireLocal()
  const accounts = localAccounts()
  const secret = localSecret()
  const owner = await signIn(accounts.owner!.email, accounts.owner!.password)
  const started = await owner.db.rpc('start_site_reading', {
    t: owner.tenant
  })
  expect(started.error).toBeNull()
  // Asking again the same day is the same read.
  expect(
    (await owner.db.rpc('start_site_reading', { t: owner.tenant })).data
  ).toBe(started.data)
  // The sweep (and an owner's "Run jobs") never takes a site read.
  await drain(request, secret)
  const waiting = await serviceClient()
    .from('job_runs')
    .select('status')
    .eq('id', started.data as string)
    .single()
  expect(waiting.data).toEqual({ status: 'queued' })
  // The onboarding readers' run does: it asks first, then reads.
  const readers = (query = '') =>
    request.get(`/api/internal/onboarding/readers${query}`, {
      headers: { authorization: `Bearer ${secret}` }
    })
  expect((await request.get('/api/internal/onboarding/readers')).status()).toBe(
    401
  )
  const peek = await readers('?peek=1')
  expect(peek.status()).toBe(200)
  expect((await peek.json()).waiting).toBeGreaterThanOrEqual(1)
  const ran = await readers()
  expect(ran.status()).toBe(200)
  expect(await ran.json()).toMatchObject({ state: 'done', failed: 0 })
  const job = await serviceClient()
    .from('job_runs')
    .select('status,checkpoint')
    .eq('id', started.data as string)
    .single()
  expect(job.data).toMatchObject({
    status: 'succeeded',
    checkpoint: { live: false }
  })
  // The sample site, read with the sample rules: each fact with its page.
  const findings = await owner.db
    .from('brand_findings')
    .select('topic,value,evidence,pass')
    .eq('tenant_id', owner.tenant)
    .is('superseded_at', null)
  expect(findings.error).toBeNull()
  const rows = findings.data as {
    topic: string
    value: unknown
    evidence: { url: string; quote: string }
    pass: string
  }[]
  expect(rows.map((f) => f.topic)).toEqual(
    expect.arrayContaining([
      'free_shipping',
      'returns',
      'guarantee',
      'delivery_days',
      'claim'
    ])
  )
  expect(rows.find((f) => f.topic === 'returns')).toMatchObject({
    value: { days: 30 },
    pass: 'sample',
    evidence: { url: 'https://cedar-lane.example/pages/returns' }
  })
  // Another workspace reads none of them.
  const other = await signIn(accounts.other!.email, accounts.other!.password)
  const none = await other.db
    .from('brand_findings')
    .select('id')
    .eq('tenant_id', owner.tenant)
  expect(none.data).toEqual([])
})

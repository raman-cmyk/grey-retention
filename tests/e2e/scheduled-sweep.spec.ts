import { randomInt, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { test, expect, type APIRequestContext } from '@playwright/test'

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
        'processed',
        'rounds',
        'tenants'
      ].sort()
    )
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

import { expect, test } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Database } from '../../lib/supabase/database.types'
import { login, type AccountRole } from './accounts'

// Run after the insufficient-evidence journey. Prepare original sends through
// authenticated domain commands and leased fixture jobs, never inserted rules.
type Db = SupabaseClient<Database>
type Job = Database['public']['Tables']['job_runs']['Row']
async function checked<
  R extends {
    data: unknown
    error: { code?: string; message: string } | null
  }
>(request: PromiseLike<R>, operation: string): Promise<NonNullable<R['data']>> {
  const { data, error } = await request
  if (error) throw new Error(`${operation}: ${error.code ?? 'failed'}`)
  return data as NonNullable<R['data']>
}
async function authenticated(role: AccountRole) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (
    !url ||
    !key ||
    !['127.0.0.1', 'localhost'].includes(new URL(url).hostname) ||
    process.env.ADAPTER_MODE !== 'fake'
  )
    throw new Error('Learning acceptance requires the local fixture runtime.')
  const accounts = JSON.parse(
    readFileSync('.audit/local-accounts.json', 'utf8')
  ) as Record<AccountRole, { email: string; password: string }>
  const db = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const { error } = await db.auth.signInWithPassword(accounts[role])
  if (error) throw new Error('Local fixture login failed.')
  return db
}
async function finishReport(db: Db, job: Job) {
  if (!job.lease_token) throw new Error('An active lease is required.')
  const args = { job: job.id, lease: job.lease_token }
  if (job.kind === 'ops.health')
    await checked(db.rpc('finish_health_check', args), 'Health completion')
  else if (job.kind === 'reports.digest')
    await checked(db.rpc('finish_result_digest', args), 'Digest completion')
  else if (job.kind === 'results.pull') {
    const input = job.input as { deliveryId: string; window: string }
    const output = await checked(
      db.rpc('fixture_result_payload', {
        ...args,
        delivery: input.deliveryId,
        window_key: input.window
      }),
      'Fixture window collection'
    )
    await checked(
      db.rpc('finish_result_job', { ...args, output }),
      'Result completion'
    )
  } else throw new Error(`Unexpected fixture setup job: ${job.kind}`)
}
async function claimExpected(db: Db, tenant: string, expected: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const jobs = await checked(db.rpc('claim_job', { t: tenant }), 'Claim job')
    const job = jobs[0]
    if (!job?.lease_token) throw new Error('Expected leased job unavailable.')
    if (job.id === expected) return job
    await finishReport(db, job)
  }
  throw new Error('Fixture queue failed to reach the expected job.')
}
async function prepareEvidence(db: Db) {
  const [context] = await checked(
    db.rpc('resolve_client_context', {}),
    'Resolve active owner context'
  )
  expect(context.tenant_role).toBe('owner')
  const t = context.tenant_id
  const brand = await checked(
    db.from('brand_profiles').select('*').eq('tenant_id', t).single(),
    'Read approved brand'
  )
  if (!brand) throw new Error('Approved brand unavailable.')
  expect(brand.approved_revision).toBe(brand.revision)
  const audience = await checked(
    db
      .from('audiences')
      .select('id')
      .eq('tenant_id', t)
      .eq('canonical_key', 'engaged')
      .single(),
    'Read fixture audience'
  )
  if (!audience) throw new Error('Fixture audience unavailable.')
  const latestSends = await checked(
    db
      .from('fixture_deliveries')
      .select('sent_at')
      .eq('tenant_id', t)
      .eq('state', 'sent')
      .order('sent_at', { ascending: false })
      .limit(1),
    'Read existing synthetic send horizon'
  )
  // Other journeys use a future reporting clock. Place this separate cohort
  // after that horizon so the unchanged thirty-day evidence guard selects it.
  const anchor = Math.max(
    Date.now(),
    Date.parse(latestSends[0]?.sent_at ?? new Date().toISOString())
  )
  const campaignIds: string[] = []
  const deliveryIds: string[] = []
  const run = randomUUID()
  for (let n = 0; n < 10; n++) {
    const schedule = new Date(anchor + (100 + n * 2) * 86400000)
    const campaign = await checked(
      db.rpc('save_campaign', {
        t,
        expected_revision: 0,
        input: {
          title: `Synthetic learning ${run} ${n + 1}`,
          goal: 'Original educational fixture; no offer or product claim.',
          channel: 'email_text',
          planned_at: schedule.toISOString(),
          audience_id: audience.id
        }
      }),
      'Create original fixture campaign'
    )
    campaignIds.push(campaign)
    await checked(
      db.rpc('approve_calendar', {
        t,
        target_id: campaign,
        expected_revision: 1
      }),
      'Owner calendar approval'
    )
    await checked(
      db.rpc('save_copy', {
        t,
        campaign,
        expected_revision: 1,
        input: {
          subject:
            n % 2 === 0
              ? 'A considered note'
              : 'A closer look at the original details, considered at your own pace',
          preheader: 'Original synthetic evidence',
          body: 'An original educational note for this fictional studio.',
          cta: 'Explore',
          url: `https://${brand.domain}/collection`
        }
      }),
      'Save original copy'
    )
    await checked(
      db.rpc('approve_copy', { t, campaign, expected_revision: 2 }),
      'Exact owner copy approval'
    )
    const renderJob = await checked(
      db.rpc('enqueue_render', {
        t,
        campaign,
        expected_copy: 2,
        expected_design: 2
      }),
      'Queue text artifact'
    )
    let job = await claimExpected(db, t, renderJob)
    await checked(
      db.rpc('reserve_fixture_usage', {
        t,
        operation: job.id,
        feature: 'design',
        estimate: 2000
      }),
      'Reserve fixture rendering usage'
    )
    const render = await checked(
      db.rpc('finish_render_job', {
        job: job.id,
        lease: job.lease_token!,
        output: { synthetic: true, strips: [] }
      }),
      'Complete inspectable text artifact'
    )
    const current = await checked(
      db.from('campaigns').select('*').eq('id', campaign).single(),
      'Read exact artifact revision'
    )
    if (!current) throw new Error('Current campaign unavailable.')
    await checked(
      db.rpc('review_render', {
        t,
        render,
        expected_revision: current.design_revision,
        decision: 'approved',
        section: 'whole_design',
        feedback: 'Owner approves this exact original synthetic text artifact.'
      }),
      'Owner artifact approval'
    )
    const pkg = await checked(
      db.rpc('create_delivery_package', {
        t,
        campaign,
        expected_revision: current.delivery_revision,
        settings: {
          senderName: 'Synthetic studio',
          senderEmail: `studio@${brand.domain}`,
          address: '42 Fictional Road, Synthetic Town',
          unsubscribeUrl: `https://${brand.domain}/unsubscribe`,
          privacyUrl: `https://${brand.domain}/privacy`
        }
      }),
      'Create immutable verified package'
    )
    const packageRow = await checked(
      db.from('delivery_packages').select('revision').eq('id', pkg).single(),
      'Read exact package revision'
    )
    if (!packageRow) throw new Error('Exact package unavailable.')
    const deliveryJob = await checked(
      db.rpc('enqueue_delivery', {
        t,
        package: pkg,
        expected_revision: packageRow.revision
      }),
      'Confirm simulated scheduling'
    )
    job = await claimExpected(db, t, deliveryJob)
    for (const command of ['reconcile', 'prepare', 'schedule'])
      await checked(
        db.rpc('fixture_delivery_command', {
          job: job.id,
          lease: job.lease_token!,
          command
        }),
        'Persist fixture provider state'
      )
    await checked(
      db.rpc('finish_delivery_job', { job: job.id, lease: job.lease_token! }),
      'Confirm fixture delivery state'
    )
    const delivery = await checked(
      db.from('fixture_deliveries').select('*').eq('package_id', pkg).single(),
      'Read confirmed fixture identity'
    )
    if (!delivery) throw new Error('Confirmed fixture identity unavailable.')
    expect(delivery.state).toBe('scheduled')
    await checked(
      db.rpc('confirm_fixture_sent', {
        t,
        delivery: delivery.id,
        observed_at: delivery.scheduled_at!
      }),
      'Record synthetic confirmed send'
    )
    deliveryIds.push(delivery.id)
  }
  await checked(
    db.rpc('advance_results_clock', {
      t,
      observed_at: new Date(anchor + 126 * 86400000).toISOString()
    }),
    'Mature bounded synthetic result windows'
  )
  for (let attempt = 0; attempt < 40; attempt++) {
    const jobs = await checked(
      db.rpc('claim_job', { t }),
      'Claim reporting job'
    )
    if (!jobs[0]) break
    await finishReport(db, jobs[0])
    if (attempt === 39) throw new Error('Reporting queue did not drain.')
  }
  const results = await checked(
    db.from('campaign_results').select('*').in('delivery_id', deliveryIds),
    'Read persisted learning evidence'
  )
  expect(results).toHaveLength(20)
  expect(
    results.every((r) => r.source === 'fixture' && r.complete && r.comparable)
  ).toBe(true)
  return { t, campaign: campaignIds[0] }
}

test('UC-12 owner inspects real fixture evidence, pins and dismisses an exact learned rule', async ({
  page
}, info) => {
  test.setTimeout(120_000)
  const role = info.project.name.startsWith('mobile') ? 'other' : 'owner'
  const db = await authenticated(role)
  const { t, campaign } = await prepareEvidence(db)
  await login(page, role)
  await page.goto('/reports')
  await page
    .getByRole('button', {
      name: 'Queue fixture learning comparison',
      exact: true
    })
    .click()
  await expect(
    page.getByRole('heading', {
      name: 'subject_length · proposed · v1',
      exact: true
    })
  ).toBeVisible()
  const article = page.locator('article').filter({
    has: page.getByRole('heading', {
      name: 'subject_length · proposed · v1',
      exact: true
    })
  })
  await article
    .getByText('Exact samples and limitations', { exact: true })
    .click()
  const evidence = JSON.parse(await article.locator('pre').innerText())
  expect(evidence).toMatchObject({
    minimumPerSide: 5,
    shortCount: 5,
    detailedCount: 5,
    window: '7d',
    source: 'fixture'
  })
  expect(evidence.samples).toHaveLength(10)
  expect(evidence.confounders).toContain(
    'Association is not causal; uncontrolled seasonality and selection'
  )
  expect(
    await checked(
      db.rpc('fixture_copy_preference', { t, campaign }),
      'Read proposed influence'
    )
  ).toEqual({})
  await article
    .getByRole('button', { name: 'Review learned preference', exact: true })
    .click()
  await page.getByLabel('Learning decision').selectOption('pinned')
  await page
    .getByRole('button', { name: 'Confirm learning decision', exact: true })
    .click()
  await expect(
    page.getByRole('heading', {
      name: 'subject_length · pinned · v2',
      exact: true
    })
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(
    page.getByRole('heading', {
      name: 'subject_length · pinned · v2',
      exact: true
    })
  ).toBeVisible()
  const preference = (await checked(
    db.rpc('fixture_copy_preference', { t, campaign }),
    'Read pinned influence'
  )) as { ruleId: string; preferredGroup: string }
  expect(preference.preferredGroup).toBe('short')
  await page
    .getByRole('button', { name: 'Review learned preference', exact: true })
    .click()
  await page.getByLabel('Learning decision').selectOption('dismissed')
  await page
    .getByRole('button', { name: 'Confirm learning decision', exact: true })
    .click()
  await expect(
    page.getByRole('heading', {
      name: 'subject_length · dismissed · v3',
      exact: true
    })
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await page.reload()
  await page
    .getByRole('button', {
      name: 'Queue fixture learning comparison',
      exact: true
    })
    .click()
  await expect(
    page.getByRole('heading', {
      name: 'subject_length · dismissed · v3',
      exact: true
    })
  ).toBeVisible()
  expect(
    await checked(
      db.rpc('fixture_copy_preference', { t, campaign }),
      'Read dismissed influence'
    )
  ).toEqual({})
  const foreign = await authenticated(role === 'owner' ? 'other' : 'owner')
  expect(
    await checked(
      foreign.from('learned_rules').select('id').eq('id', preference.ruleId),
      'Foreign learning isolation'
    )
  ).toEqual([])
  const denied = await foreign.rpc('review_learned_rule', {
    t,
    rule: preference.ruleId,
    expected_revision: 3,
    decision: 'pinned'
  })
  expect(denied.error?.code).toBe('42501')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: `.audit/learning-${info.project.name}.png`,
    fullPage: true
  })
  await page
    .locator('article')
    .filter({
      has: page.getByRole('heading', {
        name: 'subject_length · dismissed · v3',
        exact: true
      })
    })
    .screenshot({ path: `.audit/learning-rule-${info.project.name}.png` })
  await db.auth.signOut()
  await foreign.auth.signOut()
})

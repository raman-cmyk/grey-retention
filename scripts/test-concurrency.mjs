import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { prepareAccounts } from './local-runtime.mjs'

// Disposable local Auth/database only; exercise real RPC transactions, never a provider.
const local = await prepareAccounts()
const db = createClient(local.url, local.anon, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (url, init) =>
      fetch(url, { ...init, signal: AbortSignal.timeout(15000) })
  }
})
const signedIn = await db.auth.signInWithPassword(local.accounts.owner)
assert.equal(signedIn.error, null)
const context = await db.rpc('resolve_client_context')
assert.equal(context.error, null)
const tenant = context.data[0].tenant_id
const [brand, audience] = await Promise.all([
  db
    .from('brand_profiles')
    .select('revision,domain')
    .eq('tenant_id', tenant)
    .single(),
  db.from('audiences').select('id').eq('tenant_id', tenant).limit(1).single()
])
assert.equal(brand.error, null)
assert.equal(audience.error, null)
let concurrentReplays = 0
for (let n = 0; n < 20; n++) {
  const saved = await db.rpc('save_campaign', {
    t: tenant,
    input: {
      title: `Synthetic transaction proof ${randomUUID()}`,
      goal: 'Original synthetic transaction evidence. No offer or factual claim.',
      planned_at: new Date(Date.now() + (500 + 7 * n) * 86400000).toISOString(),
      channel: 'email_text',
      audience_id: audience.data.id,
      reference_notes: ''
    }
  })
  assert.equal(saved.error, null)
  const campaign = saved.data
  assert.equal(
    (
      await db.rpc('approve_calendar', {
        t: tenant,
        target_id: campaign,
        expected_revision: 1
      })
    ).error,
    null
  )
  const job = await db.rpc('enqueue_copy', {
    t: tenant,
    campaign,
    expected_revision: 1
  })
  assert.equal(job.error, null)
  const claimed = await db.rpc('claim_job', { t: tenant })
  assert.equal(claimed.error, null)
  assert.equal(
    claimed.data[0]?.id,
    job.data,
    'run on a freshly reset local database'
  )
  const finish = {
    job: job.data,
    lease: claimed.data[0].lease_token,
    output: {
      synthetic: true,
      brandRevision: brand.data.revision,
      subject: 'An original considered note',
      subjects: ['An original considered note'],
      preheader: 'Original synthetic preview.',
      body: 'Explore the details at your own pace.',
      cta: 'Explore',
      url: `https://${brand.data.domain}`
    }
  }
  const results = await Promise.all([
    db.rpc('finish_copy_job', finish),
    db.rpc('enqueue_copy', { t: tenant, campaign, expected_revision: 1 }),
    db.rpc('finish_copy_job', finish)
  ])
  assert.equal(
    results.filter((r, i) => i !== 1 && !r.error).length,
    1,
    'only one lease completion commits'
  )
  assert.ok(
    results.every((r) => !r.error || ['23514', 'PT409'].includes(r.error.code)),
    `no deadlock or unexpected transaction failure: ${results.map((r) => r.error?.code ?? 'ok').join(',')}`
  )
  for (const result of results)
    if (result.error?.code === 'PT409') assert.equal(result.status, 409)
  if (!results[1].error) {
    assert.equal(
      results[1].data,
      job.data,
      'concurrent enqueue reuses the same durable job'
    )
    concurrentReplays++
  }
  const [current, content] = await Promise.all([
    db
      .from('campaigns')
      .select('copy_revision,copy_state')
      .eq('id', campaign)
      .single(),
    db
      .from('campaign_content')
      .select('id', { count: 'exact' })
      .eq('campaign_id', campaign)
      .eq('revision', 2)
  ])
  assert.equal(current.error, null)
  assert.equal(content.error, null)
  assert.equal(current.data.copy_revision, 2)
  assert.equal(current.data.copy_state, 'pending_approval')
  assert.equal(content.count, 1, 'exactly one immutable generated version')
}
console.log(
  `PASS: 20 simultaneous enqueue/duplicate-completion races; 20 exact immutable versions, no deadlocks; ${concurrentReplays} enqueue replays. Local synthetic providers only.`
)

// Force a visibility change while an authorized shared-chat request waits for its tenant lock.
// The permission must be rechecked after the change, before any message or usage is persisted.
const staff = createClient(local.url, local.anon, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (url, init) =>
      fetch(url, { ...init, signal: AbortSignal.timeout(15000) })
  }
})
assert.equal(
  (await staff.auth.signInWithPassword(local.accounts.staff)).error,
  null
)
const chat = await db.rpc('create_conversation', {
  t: tenant,
  title: 'Synthetic visibility-lock proof',
  visibility: 'shared'
})
assert.equal(chat.error, null)
const campaign = await db
  .from('campaigns')
  .select('id')
  .eq('tenant_id', tenant)
  .limit(1)
  .single()
assert.equal(campaign.error, null)
const locker = spawn(
  'docker',
  [
    'exec',
    '-i',
    'supabase_db_grey-retention',
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-qAt'
  ],
  { stdio: ['pipe', 'pipe', 'pipe'] }
)
const exited = new Promise((resolve) => locker.once('exit', resolve))
try {
  const ready = new Promise((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(
      () => reject(new Error('Local lock setup timed out')),
      5000
    )
    locker.stdout.on('data', (data) => {
      output += data.toString()
      if (output.includes('LOCKED')) {
        clearTimeout(timeout)
        resolve()
      }
    })
    locker.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
  locker.stdin.write(
    `begin; select set_config('request.jwt.claim.sub','${signedIn.data.user.id}',true); select id from public.tenants where id='${tenant}' for update; select 'LOCKED';\n`
  )
  await ready
  const pending = staff
    .rpc('ask_fixture_gros', {
      t: tenant,
      chat: chat.data,
      campaign: campaign.data.id,
      question: 'Original question during a concurrent visibility change'
    })
    .then((r) => r)
  let blocked = false
  for (let attempt = 0; attempt < 20 && !blocked; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    const count = execFileSync(
      'docker',
      [
        'exec',
        'supabase_db_grey-retention',
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-qAtc',
        "select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%ask_fixture_gros%';"
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    )
    blocked = Number(count.trim()) > 0
  }
  assert.ok(
    blocked,
    'the shared chat request actually reached the lock boundary'
  )
  locker.stdin.end(
    `select public.set_conversation_visibility('${tenant}','${chat.data}','private'); commit;\n`
  )
  assert.equal(await exited, 0)
  const answer = await pending
  assert.equal(
    answer.error?.code,
    '42501',
    'visibility changed while waiting; no private-chat mutation permitted'
  )
  const messages = await db
    .from('chat_messages')
    .select('id', { count: 'exact' })
    .eq('conversation_id', chat.data)
  assert.equal(messages.error, null)
  assert.equal(
    messages.count,
    0,
    'denied concurrent request persisted no content'
  )
  console.log(
    'PASS: forced shared-to-private visibility race denied the waiting staff request before message/budget mutation.'
  )
} finally {
  if (locker.exitCode === null) {
    locker.stdin.end('rollback;\n')
    locker.kill('SIGTERM')
    await exited
  }
}

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { prepareAccounts } from './local-runtime.mjs'
const local = await prepareAccounts()
const make = () =>
  createClient(local.url, local.anon, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
const owner = make(),
  admin = make()
for (const [db, account] of [
  [owner, local.accounts.other],
  [admin, local.accounts.admin]
]) {
  const r = await db.auth.signInWithPassword(account)
  assert.equal(r.error, null, 'local synthetic authentication failed')
}
const context = await owner.rpc('resolve_client_context')
assert.equal(context.error, null)
const tenant = context.data[0].tenant_id
const original = await admin
  .from('packages')
  .select('id')
  .eq('name', 'Synthetic fixture starter')
  .single()
assert.equal(original.error, null)
const proof = await admin.rpc('define_fixture_package', {
  name: `Synthetic concurrency proof ${randomUUID()}`,
  allocation: 10000,
  daily: 10000
})
assert.equal(proof.error, null)
assert.equal(
  (
    await admin.rpc('assign_fixture_package', {
      t: tenant,
      package: proof.data
    })
  ).error,
  null
)
try {
  const operations = Array.from({ length: 20 }, () => randomUUID())
  const results = await Promise.all(
    operations.map((operation) =>
      owner.rpc('reserve_fixture_usage', {
        t: tenant,
        operation,
        feature: 'copy',
        estimate: 1000
      })
    )
  )
  const accepted = results.filter((r) => !r.error)
  assert.equal(
    accepted.length,
    10,
    'exactly ten simultaneous reservations fit allowance'
  )
  assert.ok(
    results.filter((r) => r.error).every((r) => r.error.code === '23514')
  )
  const cycle = await owner
    .from('package_cycles')
    .select('*')
    .eq('tenant_id', tenant)
    .eq('state', 'active')
    .single()
  assert.equal(cycle.data.reserved_micro, 10000)
  const replayIndex = results.findIndex((r) => !r.error)
  const replay = await owner.rpc('reserve_fixture_usage', {
    t: tenant,
    operation: operations[replayIndex],
    feature: 'copy',
    estimate: 1000
  })
  assert.equal(replay.data, results[replayIndex].data)
  await Promise.all(
    accepted.map((r) =>
      owner
        .rpc('reconcile_fixture_usage', {
          t: tenant,
          reservation: r.data,
          actual: 800
        })
        .then((r) => assert.equal(r.error, null))
    )
  )
  const finished = await owner
    .from('package_cycles')
    .select('*')
    .eq('id', cycle.data.id)
    .single()
  assert.equal(finished.data.used_micro, 8000)
  assert.equal(finished.data.reserved_micro, 0)
  const alerts = await owner
    .from('budget_alerts')
    .select('*')
    .eq('cycle_id', cycle.data.id)
  assert.equal(alerts.data.length, 2)
  console.log(
    'PASS: 20 concurrent requests, exactly 10 accepted; replay and actual reconciliation preserved cap; 80% alerts deduplicated. Fixture-only, no paid call.'
  )
} finally {
  const r = await admin.rpc('assign_fixture_package', {
    t: tenant,
    package: original.data.id
  })
  assert.equal(r.error, null, 'restore fixture package after proof')
}

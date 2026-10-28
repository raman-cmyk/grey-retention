import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { prepareAccounts } from './local-runtime.mjs'

// Disposable loopback fixtures only. No generation, provider calls or delivery.
const local = await prepareAccounts()
const db = createClient(local.url, local.anon, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (url, init) =>
      fetch(url, { ...init, signal: AbortSignal.timeout(15000) })
  }
})
assert.equal(
  (await db.auth.signInWithPassword(local.accounts.owner)).error,
  null
)
const context = await db.rpc('resolve_client_context')
assert.equal(context.error, null)
const tenant = context.data[0].tenant_id
const requestKey = randomUUID()
const input = {
  title: `Original retry acceptance ${randomUUID()}`,
  goal: 'Explain the fictional studio without an offer or product claim.',
  channel: 'email_text',
  planned_at: new Date(Date.now() + 30 * 86400000).toISOString(),
  audience_id: '',
  product_id: '',
  offer_id: '',
  reference_notes: ''
}
const command = {
  t: tenant,
  request_key: requestKey,
  source: 'original',
  input
}
const results = await Promise.all(
  Array.from({ length: 12 }, () => db.rpc('create_first_draft', command))
)
for (const result of results) assert.equal(result.error, null)
const ids = new Set(results.map((result) => result.data))
assert.equal(ids.size, 1)
const saved = await db
  .from('campaigns')
  .select('id,calendar_state,copy_state,delivery_state')
  .eq('tenant_id', tenant)
  .eq('title', input.title)
assert.equal(saved.error, null)
assert.equal(saved.data.length, 1)
assert.equal(saved.data[0].calendar_state, 'proposed')
assert.equal(saved.data[0].copy_state, 'draft')
assert.equal(saved.data[0].delivery_state, 'not_ready')
const conflict = await db.rpc('create_first_draft', {
  ...command,
  input: { ...input, title: `${input.title} changed` }
})
assert.equal(conflict.error?.code, 'PT409')
console.log(
  '12 concurrent requests returned one unapproved saved draft; changed-input replay was rejected.'
)

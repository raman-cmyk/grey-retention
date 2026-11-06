import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { prepareAccounts } from './local-runtime.mjs'

// Disposable loopback fixtures only. No provider is called: the worker RPCs are
// exercised directly with synthetic usage to prove concurrency guarantees.
const local = await prepareAccounts()
const options = {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (url, init) =>
      fetch(url, { ...init, signal: AbortSignal.timeout(15000) })
  }
}
const owner = createClient(local.url, local.anon, options)
const service = createClient(local.url, local.service, options)
assert.equal(
  (await owner.auth.signInWithPassword(local.accounts.owner)).error,
  null
)
const t = (await owner.rpc('resolve_client_context')).data[0].tenant_id
const imported = await owner.rpc('import_pasted_reference', {
  t,
  request_key: randomUUID(),
  input: {
    subject: `Concurrency ${randomUUID().slice(0, 8)}`,
    body: '<table><tr><td>Original concurrency email</td></tr></table>',
    readable_text: 'Original concurrency email',
    source_description: '',
    source_url: ''
  }
})
assert.equal(imported.error, null)

// 12 identical "Rewrite" clicks create one result and one queued rewrite.
const key = randomUUID()
const created = await Promise.all(
  Array.from({ length: 12 }, () =>
    owner.rpc('create_email_result', {
      t,
      request_key: key,
      import_id: imported.data,
      mode: 'rewrite',
      options: {}
    })
  )
)
for (const r of created) assert.equal(r.error, null)
assert.equal(new Set(created.map((r) => r.data)).size, 1)
const result = created[0].data
const generations = await owner
  .from('email_generations')
  .select('id')
  .eq('result_id', result)
assert.equal(generations.data.length, 1)
const generation = generations.data[0].id

// 10 workers race for the lease: exactly one wins.
const claims = await Promise.all(
  Array.from({ length: 10 }, () =>
    service.rpc('claim_email_generation', { t, generation })
  )
)
for (const c of claims) assert.equal(c.error, null)
const winners = claims.filter((c) => c.data.length === 1)
assert.equal(winners.length, 1)
const lease = {
  job: winners[0].data[0].job_id,
  lease: winners[0].data[0].lease_token
}

// 8 concurrent dispatch attempts reserve spend exactly once.
const dispatches = await Promise.all(
  Array.from({ length: 8 }, () =>
    service.rpc('begin_email_dispatch', {
      ...lease,
      estimate: 2000,
      provider: 'openai',
      model: 'gpt-6.1-terra',
      prompt_version: 'email-rewrite-v1'
    })
  )
)
assert.equal(dispatches.filter((d) => !d.error).length, 1)

// 8 concurrent completions save exactly one version.
const output = {
  subject: 'Concurrency subject',
  subjectOptions: ['Concurrency subject'],
  preheader: '',
  body: 'Body',
  cta: 'Go',
  url: 'https://cedar-lane.example/',
  html: '<p>Body</p>',
  checks: []
}
const finishes = await Promise.all(
  Array.from({ length: 8 }, () =>
    service.rpc('finish_email_generation', {
      ...lease,
      output,
      usage: { inputTokens: 100, outputTokens: 10, costMicro: 150 }
    })
  )
)
assert.equal(finishes.filter((f) => !f.error).length, 1)
const revisions = await owner
  .from('email_result_revisions')
  .select('revision')
  .eq('result_id', result)
assert.equal(revisions.data.length, 1)
const gen = await owner
  .from('email_generations')
  .select('state,dispatches,cost_micro')
  .eq('id', generation)
  .single()
assert.deepEqual(gen.data, {
  state: 'succeeded',
  dispatches: 1,
  cost_micro: 150
})
// The signed-in owner cannot drive the paid worker directly.
const direct = await owner.rpc('claim_email_generation', { t, generation })
assert.ok(direct.error)
console.log(
  '12 concurrent rewrite requests -> 1 result/1 job; 10 lease races -> 1 lease; 8 dispatch races -> 1 reservation; 8 completions -> 1 saved version; owner worker RPC denied.'
)

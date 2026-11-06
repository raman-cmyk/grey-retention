import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { localStatus } from './local-runtime.mjs'

// Disposable loopback stack only; original synthetic files. Real concurrent
// sessions race the admission, Storage write, finalize and worker RPCs that the
// upload action uses. No provider or paid service is involved.
const local = localStatus()
const options = {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (url, init) =>
      fetch(url, { ...init, signal: AbortSignal.timeout(20000) })
  }
}
const service = createClient(local.url, local.service, options)
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const pathFor = (t, bytes) => `${t}/${sha(bytes)}.eml`
const message = (label) =>
  Buffer.from(
    `Subject: ${label}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nOriginal concurrency email ${label}\r\n`
  )

async function freshOwner() {
  const email = `file-race-${randomUUID()}@grey-retention.test`
  const password = randomUUID()
  assert.equal(
    (
      await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      })
    ).error,
    null
  )
  const sessions = []
  // Several independent signed-in sessions for the same owner (tabs/devices).
  for (let i = 0; i < 4; i++) {
    const client = createClient(local.url, local.anon, options)
    assert.equal(
      (await client.auth.signInWithPassword({ email, password })).error,
      null
    )
    sessions.push(client)
  }
  const workspace = await sessions[0].rpc('create_tenant_workspace', {
    workspace_name: 'File race studio',
    workspace_slug: `file-race-${randomUUID()}`,
    workspace_timezone: 'UTC'
  })
  assert.equal(workspace.error, null)
  const t = (await sessions[0].rpc('resolve_client_context')).data[0].tenant_id
  return { t, sessions }
}
const input = (bytes, fileName = 'race.eml') => ({
  sha256: sha(bytes),
  byteSize: bytes.length,
  kind: 'eml',
  fileName,
  title: ''
})
const session = (sessions, i) => sessions[i % sessions.length]

// 1. Double submit across sessions: 12 identical admissions with one request key.
{
  const { t, sessions } = await freshOwner()
  const bytes = message('double')
  const key = randomUUID()
  const admitted = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      session(sessions, i).rpc('admit_email_file_upload', {
        t,
        request_key: key,
        input: input(bytes)
      })
    )
  )
  for (const r of admitted) assert.equal(r.error, null)
  assert.equal(new Set(admitted.map((r) => r.data[0].import_id)).size, 1)
  // A replay with different bytes under the same key is refused.
  const changed = await sessions[0].rpc('admit_email_file_upload', {
    t,
    request_key: key,
    input: input(message('other'))
  })
  assert.equal(changed.error?.code, 'PT409')

  // 2. Lost upload response: the write is repeated by several sessions; one object.
  const writes = await Promise.all(
    Array.from({ length: 6 }, () =>
      service.storage.from('email-imports').upload(pathFor(t, bytes), bytes, {
        contentType: 'message/rfc822',
        upsert: false
      })
    )
  )
  // Storage lets overlapping writers both finish (last wins) and refuses later
  // ones; the path is the SHA-256 of the server-validated bytes, so every racer
  // writes identical bytes and the stored object always matches its admission.
  for (const w of writes.filter((w) => w.error))
    assert.match(w.error.message, /exists/i)
  const later = await service.storage
    .from('email-imports')
    .upload(pathFor(t, bytes), Buffer.from('tampered'), {
      contentType: 'message/rfc822',
      upsert: false
    })
  assert.match(later.error?.message ?? '', /exists/i)
  const stored = await service.storage
    .from('email-imports')
    .download(pathFor(t, bytes))
  assert.equal(sha(Buffer.from(await stored.data.arrayBuffer())), sha(bytes))
  assert.equal(
    (await service.storage.from('email-imports').list(t)).data.length,
    1
  )
  // Replay after the lost response no longer asks for a write.
  const replay = await sessions[1].rpc('admit_email_file_upload', {
    t,
    request_key: key,
    input: input(bytes)
  })
  assert.equal(replay.data[0].needs_upload, false)

  // 3. Finalize races: one durable job.
  const id = admitted[0].data[0].import_id
  const finals = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      session(sessions, i).rpc('finalize_email_file_upload', { t, import: id })
    )
  )
  for (const f of finals) assert.equal(f.error, null)
  const jobs = await sessions[0]
    .from('job_runs')
    .select('id')
    .eq('kind', 'email.import')
  assert.equal(jobs.data.length, 1)

  // 4. Worker lease races: exactly one claim wins; a second finish is refused.
  const claims = await Promise.all(
    Array.from({ length: 10 }, () =>
      service.rpc('claim_email_file_import', { t, import: id })
    )
  )
  for (const c of claims) assert.equal(c.error, null)
  const winners = claims.filter((c) => c.data.length === 1)
  assert.equal(winners.length, 1)
  const lease = {
    job: winners[0].data[0].job_id,
    lease: winners[0].data[0].lease_token
  }
  const output = {
    sha256: sha(bytes),
    subject: 'double',
    body: 'Original concurrency email double\n',
    readableText: 'Original concurrency email double',
    format: 'text',
    attachmentCount: 0
  }
  const finishes = await Promise.all(
    Array.from({ length: 6 }, () =>
      service.rpc('finish_email_file_import', { ...lease, output })
    )
  )
  assert.equal(finishes.filter((f) => !f.error).length, 1)
  const references = await sessions[0]
    .from('reference_imports')
    .select('id')
    .eq('source_kind', 'file')
  assert.equal(references.data.length, 1)
  // An owner session can never lease trusted file work.
  assert.equal(
    (await sessions[0].rpc('claim_email_file_import', { t, import: id })).error
      ?.code,
    '42501'
  )
  console.log(
    'double submit, lost upload response, finalize and lease races: one import, one object, one job, one reference'
  )
}

// 5. Same file, different request keys, many sessions: deduplicated to one import.
{
  const { t, sessions } = await freshOwner()
  const bytes = message('dedupe')
  const admitted = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      session(sessions, i).rpc('admit_email_file_upload', {
        t,
        request_key: randomUUID(),
        input: input(bytes)
      })
    )
  )
  for (const r of admitted) assert.equal(r.error, null)
  assert.equal(new Set(admitted.map((r) => r.data[0].import_id)).size, 1)
  const rows = await sessions[0].from('email_file_imports').select('id')
  assert.equal(rows.data.length, 1)
  console.log('10 concurrent uploads of the same file: one import')
}

// 6. Admission race at the caps: capacity is reserved transactionally before any write.
{
  const { t, sessions } = await freshOwner()
  // The maximum raw size; at 4 MiB the hourly cap (20) binds before the
  // 100 MiB byte cap, which the SQL suite exercises across two hours.
  const big = 4 * 1024 * 1024
  const admitted = await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      session(sessions, i).rpc('admit_email_file_upload', {
        t,
        request_key: randomUUID(),
        input: {
          sha256: sha(Buffer.from(`file-${i}`)),
          byteSize: big,
          kind: 'eml',
          fileName: `big-${i}.eml`,
          title: ''
        }
      })
    )
  )
  const accepted = admitted.filter((r) => !r.error)
  const refused = admitted.filter((r) => r.error)
  assert.equal(accepted.length, 20)
  for (const r of refused) {
    assert.equal(r.error.code, '23514')
    assert.equal(r.error.message, 'File upload limit reached; try again later')
  }
  const rows = await sessions[0].from('email_file_imports').select('byte_size')
  assert.equal(rows.data.length, 20)
  assert.ok(
    rows.data.reduce((sum, r) => sum + r.byte_size, 0) <= 100 * 1024 * 1024
  )
  // No object exists for any admission: nothing was written before admission.
  const listed = await service.storage.from('email-imports').list(t)
  assert.equal(listed.data.length, 0)
  console.log(
    `30 concurrent 4 MiB admissions: ${accepted.length} reserved (hourly cap), ${refused.length} refused, 0 objects written`
  )
}

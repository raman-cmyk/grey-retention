import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export function localStatus() {
  const raw = JSON.parse(
    execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
  )
  const status = raw.API_URL ? raw : (raw.data ?? raw.payload ?? raw)
  const url = status.API_URL ?? status.api_url
  if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname))
    throw new Error(
      'Only a running loopback Supabase instance is supported; live fixtures are forbidden.'
    )
  return {
    url,
    anon: status.ANON_KEY ?? status.anon_key,
    service: status.SERVICE_ROLE_KEY ?? status.service_role_key
  }
}
export async function prepareAccounts() {
  const status = localStatus()
  if (!status.anon || !status.service)
    throw new Error('Local Supabase keys unavailable.')
  const admin = createClient(status.url, status.service, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const fixtures = [
    [
      'owner',
      '00000000-0000-4000-8000-000000000001',
      'owner@grey-retention.test'
    ],
    [
      'admin',
      '00000000-0000-4000-8000-000000000002',
      'admin@grey-retention.test'
    ],
    [
      'designer',
      '00000000-0000-4000-8000-000000000003',
      'designer@grey-retention.test'
    ],
    [
      'other',
      '00000000-0000-4000-8000-000000000004',
      'other-owner@grey-retention.test'
    ],
    [
      'staff',
      '00000000-0000-4000-8000-000000000005',
      'staff@grey-retention.test'
    ]
  ]
  const accounts = {}
  for (const [role, id, email] of fixtures) {
    const password = randomBytes(24).toString('base64url')
    const { error } = await admin.auth.admin.updateUserById(id, {
      password,
      email_confirm: true
    })
    if (error)
      throw new Error(
        `Local synthetic account setup failed for ${role}. Reset the disposable local database.`
      )
    accounts[role] = { email, password }
  }
  mkdirSync('.audit', { recursive: true })
  writeFileSync('.audit/local-accounts.json', JSON.stringify(accounts), {
    mode: 0o600
  })
  const cronSecret = randomBytes(32).toString('hex')
  writeFileSync('.audit/local-cron-secret.txt', cronSecret, { mode: 0o600 })
  return { ...status, accounts, cronSecret }
}
export function localEnvironment(status) {
  return {
    ...process.env,
    AUTH_MODE: 'supabase',
    ADAPTER_MODE: 'fake',
    // Local runs and browser journeys never call Klaviyo, whatever a local
    // env file says (KLV-001).
    KLAVIYO_MODE: 'fake',
    NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
    NEXT_PUBLIC_SUPABASE_URL: status.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: status.anon,
    SUPABASE_SERVICE_ROLE_KEY: status.service,
    GREY_LOCAL_E2E: '1',
    CRON_SECRET: status.cronSecret
  }
}
export function accounts() {
  return JSON.parse(readFileSync('.audit/local-accounts.json', 'utf8'))
}

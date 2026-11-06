/**
 * Plain-language provider status for the admin Operations page.
 * Pure: takes already-sanitized availability and job facts, never keys.
 */
export type RewriteAvailability = {
  ready: boolean
  sample: boolean
  reason: string | null
}

export type JobFact = {
  kind: string
  status: string
  error_code: string | null
}

const setupReasons: Record<string, string> = {
  missing_key: 'no OpenAI key is set on the server',
  unsupported_model: 'the configured OpenAI model is not on the allowed list',
  invalid_base_url: 'the OpenAI address setting is invalid',
  sample_disabled: 'the sample writer is switched off in production',
  missing_service_credential: 'the server worker credential is missing',
  workspace_not_enabled: 'this workspace is not on the AI pilot list'
}

const failureCodes: Record<string, string> = {
  provider_account: 'OpenAI refused the request (billing or access)'
}

export type ProviderStatus = {
  label: string
  state: 'ok' | 'attention' | 'off'
  detail: string
}

export function rewriteStatus(
  availability: RewriteAvailability,
  jobs: JobFact[]
): ProviderStatus {
  const label = availability.sample
    ? 'Email rewrite AI (sample writer)'
    : 'Email rewrite AI (OpenAI)'
  if (!availability.ready)
    return {
      label,
      state: 'off',
      detail: `Not available: ${setupReasons[availability.reason ?? ''] ?? 'setup incomplete'}.`
    }
  const last = jobs.find((j) => j.kind === 'email.rewrite')
  if (last?.status === 'failed')
    return {
      label,
      state: 'attention',
      detail: `Set up, but the last rewrite failed: ${
        failureCodes[last.error_code ?? ''] ??
        last.error_code ??
        'unknown error'
      }.`
    }
  return {
    label,
    state: 'ok',
    detail: last
      ? 'Set up; last rewrite succeeded.'
      : 'Set up; no rewrite run yet.'
  }
}

export const connectionsEmptyText =
  'No workspace has a Klaviyo, Shopify or Google Drive connection. Live connections to these services are not built yet.'

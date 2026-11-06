/**
 * Format checks for the Connections screen. Pure functions: they never call a
 * provider and never return or log the secret itself, only a masked hint
 * (first characters, eight bullets, last four) the owner can recognise.
 */
export type Checked<T> = { ok: true; value: T } | { ok: false; error: string }

/** `pk_YxS7U••••••••9de0`: keeps `keep` leading characters and the last 4. */
export function maskSecret(secret: string, keep: number) {
  return `${secret.slice(0, keep)}••••••••${secret.slice(-4)}`
}

const text = (input: unknown) => (typeof input === 'string' ? input.trim() : '')

/** Klaviyo private API keys start with `pk_`. */
export function checkKlaviyoKey(input: unknown): Checked<{ hint: string }> {
  const key = text(input)
  if (!key) return { ok: false, error: 'Paste your Klaviyo private API key.' }
  if (/^pk_[A-Za-z0-9]{20,64}$/.test(key))
    return { ok: true, value: { hint: maskSecret(key, 8) } }
  if (/^[A-Za-z0-9]{6}$/.test(key))
    return {
      ok: false,
      error:
        'That looks like your public site ID. Use a private API key — it starts with pk_.'
    }
  return {
    ok: false,
    error:
      'That is not a Klaviyo private API key. It starts with pk_ and has no spaces.'
  }
}

/**
 * The store's `.myshopify.com` address. Accepts `https://` and a trailing
 * slash or path, and a bare store name. Refuses email addresses (browsers
 * autofilled one here in the old app) and custom domains.
 */
export function checkShopDomain(input: unknown): Checked<string> {
  const raw = text(input).toLowerCase()
  if (!raw)
    return { ok: false, error: 'Enter your store’s .myshopify.com address.' }
  if (raw.includes('@'))
    return {
      ok: false,
      error:
        'That looks like an email address. Enter your store’s .myshopify.com address, for example your-store.myshopify.com.'
    }
  const host = raw.replace(/^https?:\/\//, '').replace(/[/?#].*$/, '')
  const domain = /^[a-z0-9][a-z0-9-]{0,62}$/.test(host)
    ? `${host}.myshopify.com`
    : host
  if (/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/.test(domain))
    return { ok: true, value: domain }
  return {
    ok: false,
    error:
      'Use the .myshopify.com address, not your custom domain. You can find it in Shopify under Settings → Domains.'
  }
}

/** Admin API access tokens start with `shpat_` (or `shpca_`). */
export function checkShopifyToken(input: unknown): Checked<{ hint: string }> {
  const token = text(input)
  if (!token) return { ok: false, error: 'Paste the Admin API access token.' }
  if (/^shpss_/.test(token))
    return {
      ok: false,
      error:
        'That is the API secret key (shpss_…), not the access token. Copy the Admin API access token instead.'
    }
  if (/^[a-f0-9]{32}$/i.test(token))
    return {
      ok: false,
      error:
        'That looks like the API key, not the Admin API access token. The access token starts with shpat_.'
    }
  if (/^shp(at|ca)_[A-Za-z0-9]{16,64}$/.test(token))
    return { ok: true, value: { hint: maskSecret(token, 10) } }
  return {
    ok: false,
    error: 'The Admin API access token starts with shpat_ or shpca_.'
  }
}

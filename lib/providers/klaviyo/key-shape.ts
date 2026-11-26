/**
 * Provider-issued private keys may contain internal underscore separators.
 * Keep the existing length bounds and the alphanumeric characters visible in
 * the database's masked hint (first five after pk_, last four). This is only
 * input validation: Klaviyo still checks the key and every required read scope.
 */
export const klaviyoPrivateKeyPattern =
  /^pk_[A-Za-z0-9]{5}[A-Za-z0-9_]{11,55}[A-Za-z0-9]{4}$/

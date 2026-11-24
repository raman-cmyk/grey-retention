import 'server-only'
import { resolveRequestContext } from './request-context'

/**
 * UI-ADM: whether the signed-in admin can also open a workspace, so the
 * admin bar offers Open workspace. Only a lookup: it never redirects and
 * grants nothing (Home checks membership again). A failed lookup hides
 * the link.
 */
export async function adminAlsoMember() {
  try {
    return (await resolveRequestContext('client'))?.kind === 'client'
  } catch {
    return false
  }
}

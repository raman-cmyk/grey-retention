import 'server-only'
import type { Route } from 'next'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import { setupReadModel } from './flow'

/**
 * Where an owner lands after signing in (UI-ONBe): `/setup` while his
 * workspace has neither finished setup nor done every step, else Home.
 * Staff and admins always land on Home (setup is the owner's); a setup
 * that cannot be read lands on Home too.
 */
export async function setupLanding(
  context: ClientRequestContext
): Promise<Route> {
  if (context.tenantRole !== 'owner') return '/home'
  try {
    const flow = (await setupReadModel(context)).flow
    return flow && !flow.finished && !flow.allDone ? '/setup' : '/home'
  } catch {
    return '/home'
  }
}

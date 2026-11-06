import { cookies } from 'next/headers'
import {
  brandCssVariables,
  defaultBrandPresentation,
  resolveAccessibleBrandPresentation,
  type BrandPresentation
} from '@/lib/branding/presentation'
import type { ShellNavigation } from './nav-data'
import { parseShellState, shellCookieName } from './shell-state'
import { ShellFrame, type ShellIdentity } from './sidebar'

/**
 * Server wrapper for the workspace frame: resolves the white-label theme and
 * the remembered sidebar state, then renders the client ShellFrame.
 */
export async function AppShell({
  children,
  navigation,
  workspace,
  contextLabel = 'Client workspace',
  identity = {
    name: 'Your account',
    initials: 'YA',
    email: null,
    role: 'Workspace member'
  },
  brand = defaultBrandPresentation
}: {
  children: React.ReactNode
  navigation: ShellNavigation
  workspace?: string
  /** Names the navigation landmarks, e.g. "Client workspace navigation". */
  contextLabel?: string
  identity?: ShellIdentity
  brand?: BrandPresentation
}) {
  const presentation = resolveAccessibleBrandPresentation(brand)
  const store = await cookies()
  return (
    <ShellFrame
      navigation={navigation}
      contextLabel={contextLabel}
      workspaceName={workspace ?? presentation.workspaceName}
      identity={identity}
      demo={
        process.env.AUTH_MODE === 'demo'
          ? {
              label: presentation.demoLabel,
              description: presentation.demoDescription
            }
          : null
      }
      initialState={parseShellState(store.get(shellCookieName)?.value)}
      style={brandCssVariables(presentation) as React.CSSProperties}
    >
      {children}
    </ShellFrame>
  )
}

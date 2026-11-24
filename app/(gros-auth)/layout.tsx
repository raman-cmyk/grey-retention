/**
 * Sign in and account screens in the GROS design (UI-AUTH): signed out
 * (or signed in without a workspace yet, on /onboarding), so no
 * membership check here and no old card around them. Each page draws the
 * focused shell itself (`FocusShell`, docs/design/BRAND.md Layout).
 */
export default function GrosAuthLayout({
  children
}: {
  children: React.ReactNode
}) {
  return children
}

import { LoadingPage } from '@/components/gros/nav'

/**
 * Setup is opening (UI-LOAD): no second `<main>` while the page streams in,
 * so not the focused shell, whose right side is the page's one `main`.
 */
export default function SetupLoading() {
  return <LoadingPage title="Set up your store" words="Opening setup" />
}

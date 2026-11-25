import { Button, ButtonLink } from '@/components/gros/button'
import { AppPage, LoadingPage } from '@/components/gros/nav'
import { EmptyState, ErrorState } from '@/components/gros/states'
import { resultsHref } from './hrefs'

/**
 * The loading, error and not-found states of the Klaviyo pages under
 * Results (UI-KLV): the bar with Results current, at once, and the way back.
 */
export function KlaviyoLoading({
  title,
  words
}: {
  /** Campaign, Flow, Flow email, Metric. */
  title: string
  /** "Opening the campaign". */
  words: string
}) {
  return <LoadingPage current="results" title={title} words={words} />
}

/** A Klaviyo page could not open: what happened, what to do, one button. */
export function KlaviyoError({
  title,
  what,
  retry
}: {
  title: string
  /** "This campaign did not open". */
  what: string
  retry: () => void
}) {
  return (
    <AppPage current="results" title={title}>
      <div>
        <ButtonLink href={resultsHref} label="Back to Results" kind="quiet" />
      </div>
      <ErrorState
        title={what}
        reason="We could not read it from Klaviyo just now. Nothing was changed."
        action={<Button label="Try again" onClick={retry} />}
      />
    </AppPage>
  )
}

/**
 * Something Klaviyo does not have (removed in Klaviyo, another store's, or
 * never there): Results stays current and one button leads back to it.
 */
export function KlaviyoNotFound() {
  return (
    <AppPage current="results" title="Not found">
      <EmptyState
        title="Not found in Klaviyo"
        action={<ButtonLink href={resultsHref} label="Back to Results" />}
      />
    </AppPage>
  )
}

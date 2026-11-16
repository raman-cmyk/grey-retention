import { Card } from '@/components/gros/card'
import { AppPage } from '@/components/gros/nav'

/** Settings is opening: the bar at once, the cards when their data is read. */
export default function SettingsLoading() {
  return (
    <AppPage current="settings" title="Settings">
      <Card>
        <p aria-live="polite" className="type-heading">
          Opening Settings
        </p>
      </Card>
    </AppPage>
  )
}

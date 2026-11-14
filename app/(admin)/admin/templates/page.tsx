import { PlaceholderPage } from '@/components/shell/placeholder-page'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Templates' }

export default function AdminTemplatesPage() {
  return (
    <PlaceholderPage
      title="Template library"
      description="Platform template curation and category management are planned."
    />
  )
}

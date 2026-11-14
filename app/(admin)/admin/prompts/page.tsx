import { PlaceholderPage } from '@/components/shell/placeholder-page'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Prompt engine' }

export default function AdminPromptsPage() {
  return (
    <PlaceholderPage
      title="Prompt engine"
      description="Prompt version management, knowledge previews and model controls are planned."
    />
  )
}

import { PlaceholderPage } from '@/components/shell/placeholder-page'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Clients' }

export default function AdminClientsPage() {
  return (
    <PlaceholderPage
      title="Client operations"
      description="A tenant roster with brand classification, integration status and usage controls is planned."
    />
  )
}

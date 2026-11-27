import type { Metadata } from 'next'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { inspirationReadModel } from '@/features/inspiration/read-model'
import { uploadCopyOn } from '@/features/email-uploads/switch'
import { libraryScratchOn } from '@/features/email-build/scratch-switch'
import { InspirationScreen } from '@/features/inspiration/screen'

export const metadata: Metadata = { title: 'Inspiration' }

/** Inspiration (UI-INSa): replaces the old library of inspirations. */
export default async function InspirationPage() {
  const context = await requireRequestContext('client')
  return (
    <InspirationScreen
      view={await inspirationReadModel(context)}
      timezone={context.timezone}
      uploads={uploadCopyOn(process.env)}
      library={libraryScratchOn(process.env)}
    />
  )
}

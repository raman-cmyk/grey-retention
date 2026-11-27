import type { Metadata } from 'next'
import { connection } from 'next/server'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { LibraryScreen } from '@/features/block-library/screen'
import { readLibraryScreen } from '@/features/block-library/screen-read'

export const metadata: Metadata = { title: 'Block library' }

/**
 * DES-ENGINE-004b: the block library (Inspiration), each layout drawn in
 * the brand's own look. The member is checked first; the blocks of this
 * workspace only are read on the server.
 */
export default async function BlockLibraryPage() {
  await connection()
  const context = await requireRequestContext('client')
  return <LibraryScreen view={await readLibraryScreen(context)} />
}

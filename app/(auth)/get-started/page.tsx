import { GettingStarted } from '@/features/onboarding/start'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Get started' }

export default async function GetStartedPage({
  searchParams
}: {
  searchParams: Promise<{ step?: string }>
}) {
  const { step } = await searchParams
  return <GettingStarted step={step} />
}

import { GettingStarted } from '@/features/onboarding/start'

export default async function GetStartedPage({
  searchParams
}: {
  searchParams: Promise<{ step?: string }>
}) {
  const { step } = await searchParams
  return <GettingStarted step={step} />
}

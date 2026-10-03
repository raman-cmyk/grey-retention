import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { cronAuthorized, localFixtureDispatch } from '@/features/cron/gate'
import { createServiceClient } from '@/lib/supabase/service'
import { runFixtureJobs } from '@/features/integrations/worker'
export const runtime = 'nodejs'
export async function POST(request: NextRequest) {
  if (
    !cronAuthorized(
      request.headers.get('authorization'),
      process.env.CRON_SECRET
    )
  )
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (
    !localFixtureDispatch(
      process.env.ADAPTER_MODE,
      process.env.NEXT_PUBLIC_SUPABASE_URL
    )
  )
    return NextResponse.json(
      { error: 'Only explicit loopback fixture dispatch is available.' },
      { status: 503 }
    )
  try {
    const reader = request.body?.getReader()
    if (!reader)
      return NextResponse.json({ error: 'Body required' }, { status: 400 })
    let bytes = 0,
      text = ''
    const decoder = new TextDecoder()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > 2048) {
        await reader.cancel()
        return NextResponse.json({ error: 'Body too large' }, { status: 413 })
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    const input = z
      .object({
        tenantId: z.uuid(),
        limit: z.number().int().min(1).max(4).default(4)
      })
      .strict()
      .safeParse(JSON.parse(text))
    if (!input.success)
      return NextResponse.json(
        { error: 'Validated tenant and bounded limit required' },
        { status: 400 }
      )
    const db = createServiceClient()
    if (!db)
      return NextResponse.json(
        { error: 'Local service configuration unavailable' },
        { status: 503 }
      )
    const processed = await runFixtureJobs(
      db,
      input.data.tenantId,
      input.data.limit
    )
    return NextResponse.json({ synthetic: true, processed, live: false })
  } catch {
    return NextResponse.json(
      { error: 'Fixture dispatch failed; inspect sanitized job diagnostics.' },
      { status: 400 }
    )
  }
}

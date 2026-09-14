import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { resolveRequestContext } from '@/features/auth/application/request-context'
import { createId } from '@/lib/id'

const surfaceSchema = z.enum(['client', 'admin', 'designer'])

export async function GET(request: NextRequest) {
  const requestId = createId()
  const parsed = surfaceSchema.safeParse(
    request.nextUrl.searchParams.get('surface') ?? 'client'
  )
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'INVALID_SURFACE', message: 'Unknown account surface.' },
        meta: { requestId }
      },
      { status: 400 }
    )
  }

  const context = await resolveRequestContext(parsed.data)
  if (!context) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'UNAUTHENTICATED', message: 'Sign in is required.' },
        meta: { requestId }
      },
      { status: 401 }
    )
  }
  return NextResponse.json({ ok: true, data: context, meta: { requestId } })
}

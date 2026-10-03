import { NextResponse } from 'next/server'
/** No callback is accepted until a live signature/transport contract is authorized and implemented. */
export async function POST() {
  return NextResponse.json(
    { error: 'Live webhooks are unavailable. No payload was ingested.' },
    { status: 503 }
  )
}

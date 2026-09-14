import { success } from '@/lib/result'

export function GET() {
  return Response.json(
    success({ status: 'live', timestamp: new Date().toISOString() })
  )
}

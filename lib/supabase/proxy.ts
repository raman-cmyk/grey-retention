import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from './database.types'

export async function refreshAuthSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return {
      response: NextResponse.next({ request }),
      authenticated: false
    }
  }

  let response = NextResponse.next({ request })
  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => {
        values.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      }
    }
  })

  const { data } = await supabase.auth.getClaims()
  return { response, authenticated: Boolean(data?.claims?.sub) }
}

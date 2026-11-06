import 'server-only'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

export type PastedReference = {
  id: string
  subject: string
  readable_text: string
  source_description: string
  source_url: string | null
  structure: string[]
  created_at: string
}

const columns =
  'id,subject,readable_text,source_description,source_url,structure,created_at'
const outline = z.array(z.string()).catch([])

// Every read is filtered by the server-authorized tenant in addition to RLS,
// so an actor with several workspaces only sees the active one.
export async function pastedReferences(tenantId: string, limit = 20) {
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { data: [] as PastedReference[], error: null }
  const result = await db
    .from('reference_imports')
    .select(columns)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .order('id')
    .limit(limit)
  return {
    data: (result.data ?? []).map((row) => ({
      ...row,
      structure: outline.parse(row.structure)
    })),
    error: result.error ? 'Pasted emails could not load.' : null
  }
}

export async function pastedReference(tenantId: string, id: string) {
  if (!z.uuid().safeParse(id).success) return { data: null, error: null }
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { data: null, error: null }
  const result = await db
    .from('reference_imports')
    .select(columns)
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()
  return {
    data: result.data
      ? { ...result.data, structure: outline.parse(result.data.structure) }
      : null,
    error: result.error ? 'Pasted email could not load.' : null
  }
}

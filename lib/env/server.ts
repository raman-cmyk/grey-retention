import 'server-only'
import { z } from 'zod'

const serverEnvironmentSchema = z.object({
  AUTH_MODE: z.enum(['supabase', 'demo']).default('supabase'),
  ADAPTER_MODE: z.enum(['fake', 'real']).default('fake'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional(),
  CREDENTIALS_ENCRYPTION_KEY: z.string().min(32).optional(),
  CRON_SECRET: z.string().min(32).optional(),
  KLAVIYO_API_REVISION: z.string().default('2026-07-15'),
  AI_DEFAULT_PROVIDER: z.string().default('fake'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional()
})

let parsedEnvironment: z.infer<typeof serverEnvironmentSchema> | undefined

export function getServerEnvironment() {
  parsedEnvironment ??= serverEnvironmentSchema.parse(process.env)
  return parsedEnvironment
}

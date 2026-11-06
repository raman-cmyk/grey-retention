import Link from 'next/link'
import type { Route } from 'next'
import { ClipboardPaste, FileUp } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Two equal ways in; the current one is marked for assistive technology. */
export function IntakeChoice({ mode }: { mode: 'paste' | 'file' }) {
  const options = [
    {
      key: 'paste',
      label: 'Paste an email',
      href: '/import-reference',
      Icon: ClipboardPaste
    },
    {
      key: 'file',
      label: 'Upload a file',
      href: '/import-reference?mode=file',
      Icon: FileUp
    }
  ] as const
  return (
    <nav aria-label="How to add the email" className="mt-6">
      <ul className="grid grid-cols-2 gap-2 rounded-xl bg-[var(--surface-hover)] p-1">
        {options.map(({ key, label, href, Icon }) => (
          <li key={key}>
            <Link
              href={href as Route}
              aria-current={mode === key ? 'page' : undefined}
              className={cn(
                'flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2',
                mode === key
                  ? 'bg-white text-[var(--text)] shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

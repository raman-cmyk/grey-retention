'use client'

import Link from 'next/link'
import { Fragment } from 'react'
import { usePathname } from 'next/navigation'
import {
  BadgeHelp,
  Bot,
  Boxes,
  CalendarDays,
  ChartNoAxesCombined,
  CircleGauge,
  ContactRound,
  FileStack,
  Image,
  FileCheck,
  Headphones,
  Library,
  Palette,
  Settings,
  Sparkles,
  UsersRound,
  type LucideIcon
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NavigationIcon, NavigationItem } from './nav-data'

const navigationIcons: Record<NavigationIcon, LucideIcon> = {
  'admin-overview': ChartNoAxesCombined,
  assignments: FileStack,
  brand: Palette,
  assets: Image,
  copy: FileCheck,
  campaigns: CalendarDays,
  clients: ContactRound,
  connections: Boxes,
  designers: UsersRound,
  gros: Sparkles,
  help: BadgeHelp,
  inspirations: Library,
  operations: Settings,
  overview: CircleGauge,
  prompts: Bot,
  settings: Settings,
  support: Headphones,
  team: UsersRound,
  templates: FileStack
}

function isCurrentPath(pathname: string, href: string) {
  if (href === '/campaign-agent' && pathname.startsWith('/campaigns/'))
    return true
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function NavigationList({
  navigation,
  label,
  variant,
  onNavigate
}: {
  navigation: NavigationItem[]
  label: string
  variant: 'sidebar' | 'popover'
  onNavigate?: () => void
}) {
  const pathname = usePathname()

  return (
    <nav
      className={cn(
        'space-y-1 px-3 py-4',
        variant === 'sidebar' && 'flex-1 overflow-y-auto'
      )}
      aria-label={label}
    >
      {navigation.map(({ label: itemLabel, href, icon, group }, index) => {
        const current = isCurrentPath(pathname, href)
        const Icon = navigationIcons[icon]

        return (
          <Fragment key={href}>
            {group && group !== navigation[index - 1]?.group && (
              <p
                className={cn(
                  'px-3 pb-2 text-[0.6875rem] font-medium text-[var(--nav-muted)]',
                  index > 0 && 'pt-5'
                )}
              >
                {group}
              </p>
            )}
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={current ? 'page' : undefined}
              className="group flex min-h-10 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm text-[var(--nav-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--nav-text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none aria-[current=page]:bg-[var(--surface-hover)] aria-[current=page]:font-semibold aria-[current=page]:text-[var(--nav-text)]"
            >
              <Icon className="size-[1.05rem] stroke-[1.8]" aria-hidden />
              <span>{itemLabel}</span>
            </Link>
          </Fragment>
        )
      })}
    </nav>
  )
}

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Compass,
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
  start: Compass,
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
  onNavigate,
  expandGroups = false
}: {
  navigation: NavigationItem[]
  label: string
  variant: 'sidebar' | 'popover'
  onNavigate?: () => void
  expandGroups?: boolean
}) {
  const pathname = usePathname()

  return (
    <nav
      className={cn(
        'space-y-1 px-3 py-5',
        variant === 'sidebar' && 'flex-1 overflow-y-auto'
      )}
      aria-label={label}
    >
      {Array.from(new Set(navigation.map((item) => item.group))).map(
        (group) => {
          const items = navigation.filter((item) => item.group === group)
          const links = items.map(({ label: itemLabel, href, icon }) => {
            const Icon = navigationIcons[icon]
            return (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                aria-current={
                  isCurrentPath(pathname, href) ? 'page' : undefined
                }
                className="group relative flex min-h-10 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm text-[var(--nav-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--nav-text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none aria-[current=page]:font-medium aria-[current=page]:text-[var(--nav-text)] aria-[current=page]:before:absolute aria-[current=page]:before:inset-y-2 aria-[current=page]:before:left-0 aria-[current=page]:before:border-l-2 aria-[current=page]:before:border-[var(--nav-text)]"
              >
                <Icon className="size-4 stroke-[1.6]" aria-hidden />
                <span>{itemLabel}</span>
              </Link>
            )
          })
          if (items[0]?.collapsible && !expandGroups)
            return (
              <details
                key={`${group}-${pathname}`}
                open={items.some((item) => isCurrentPath(pathname, item.href))}
                className="mt-4 border-t border-[var(--line)] pt-2"
              >
                <summary className="tracking-label cursor-pointer rounded-[var(--radius-control)] px-3 py-3 font-mono text-[0.6875rem] text-[var(--nav-muted)] uppercase hover:text-[var(--nav-text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
                  {group}
                </summary>
                <div className="space-y-1 pb-2">{links}</div>
              </details>
            )
          return (
            <div key={group ?? 'navigation'} className="space-y-1">
              {group && (
                <p className="tracking-label px-3 pb-2 font-mono text-[0.6875rem] text-[var(--nav-muted)] uppercase">
                  {group}
                </p>
              )}
              {links}
            </div>
          )
        }
      )}
    </nav>
  )
}

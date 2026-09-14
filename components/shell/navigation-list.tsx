'use client'

import Link from 'next/link'
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
        'space-y-1 p-3',
        variant === 'sidebar' && 'flex-1 overflow-y-auto'
      )}
      aria-label={label}
    >
      {navigation.map(({ label: itemLabel, href, icon }) => {
        const current = isCurrentPath(pathname, href)
        const Icon = navigationIcons[icon]

        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={current ? 'page' : undefined}
            className="group flex min-h-10 items-center gap-3 rounded-[10px] px-3 text-sm text-[var(--nav-muted)] transition-colors hover:bg-white/7 hover:text-white focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none aria-[current=page]:bg-white/10 aria-[current=page]:text-white"
          >
            <Icon className="size-[1.05rem] stroke-[1.8]" aria-hidden />
            <span>{itemLabel}</span>
          </Link>
        )
      })}
    </nav>
  )
}

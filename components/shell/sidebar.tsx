'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  LogOut,
  Menu,
  UserRound,
  X
} from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from 'react'
import { signOut } from '@/features/auth/presentation/actions'
import { cn } from '@/lib/utils'
import {
  isCurrentPath,
  isSoon,
  navigationLinks,
  type NavigationGroup,
  type NavigationItem,
  type ShellNavigation
} from './nav-data'
import { navigationIcons } from './nav-icons'
import {
  groupOpen,
  serializeShellState,
  shellCookieName,
  type ShellState
} from './shell-state'

export type ShellIdentity = {
  name: string
  initials: string
  email: string | null
  role: string
}

type Mode = 'full' | 'rail' | 'drawer'

const iconClass = 'size-5 shrink-0 stroke-[1.6]'

function persist(state: ShellState) {
  document.cookie = `${shellCookieName}=${serializeShellState(state)}; path=/; max-age=31536000; samesite=lax`
}

type RailTip = { label: string; top: number; left: number }
type RailTipControls = {
  show: (label: string, element: HTMLElement) => void
  hide: () => void
}
const RailTipContext = createContext<RailTipControls | null>(null)

/**
 * Hover and keyboard-focus label for an icon in the collapsed rail (§2 fix:
 * the old app had none). It is drawn once, `fixed`, outside the scrolling
 * nav so it is never clipped; the icon itself carries the same accessible
 * name, so the tooltip is visual only.
 */
function useRailTip(label: string, enabled: boolean) {
  const controls = useContext(RailTipContext)
  if (!enabled || !controls) return {}
  const show = (event: { currentTarget: HTMLElement }) =>
    controls.show(label, event.currentTarget)
  return {
    onMouseEnter: show,
    onFocus: show,
    onMouseLeave: controls.hide,
    onBlur: controls.hide
  }
}

function RailTooltip({ tip }: { tip: RailTip }) {
  return (
    <span
      aria-hidden
      data-testid="rail-tooltip"
      style={{ top: tip.top, left: tip.left }}
      className="pointer-events-none fixed z-50 -translate-y-1/2 rounded-[var(--radius-small)] bg-[var(--text)] px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-[var(--surface-raised)]"
    >
      {tip.label}
    </span>
  )
}

function SoonPill() {
  return (
    <span
      aria-hidden
      className="tracking-label ml-auto rounded-full border border-[var(--line-strong)] px-1.5 py-0.5 font-mono text-[0.625rem] leading-none text-[var(--text-muted)] uppercase"
    >
      Soon
    </span>
  )
}

/** Screen readers hear "<name> — Coming soon" (OWNER_JOURNEYS.md §2). */
function ComingSoon() {
  return <span className="sr-only"> — Coming soon</span>
}

const rowClass =
  'group relative flex min-h-10 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm text-[var(--nav-muted)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none'

function NavLink({
  item,
  current,
  mode,
  indent = false,
  onNavigate
}: {
  item: NavigationItem
  current: boolean
  mode: Mode
  indent?: boolean
  onNavigate?: () => void
}) {
  const Icon = navigationIcons[item.icon]
  const rail = mode === 'rail'
  const tip = useRailTip(item.label, rail)
  return (
    <Link
      {...tip}
      href={item.href}
      onClick={onNavigate}
      aria-current={current ? 'page' : undefined}
      aria-label={rail ? item.label : undefined}
      className={cn(
        rowClass,
        'hover:bg-[var(--surface-hover)] hover:text-[var(--nav-text)]',
        'aria-[current=page]:bg-[var(--surface-hover)] aria-[current=page]:font-medium aria-[current=page]:text-[var(--nav-text)] forced-colors:aria-[current=page]:outline forced-colors:aria-[current=page]:outline-1',
        rail && 'justify-center px-0',
        indent && !rail && 'pl-9'
      )}
    >
      <Icon className={iconClass} aria-hidden />
      {!rail && <span>{item.label}</span>}
    </Link>
  )
}

function SoonItem({
  label,
  icon
}: {
  label: string
  icon: NavigationGroup['icon']
}) {
  const Icon = navigationIcons[icon]
  return (
    <span
      aria-disabled="true"
      className={cn(
        rowClass,
        'cursor-not-allowed pl-9 text-[var(--text-faint)] opacity-70'
      )}
    >
      <Icon className={iconClass} aria-hidden />
      <span>
        {label}
        <ComingSoon />
      </span>
      <SoonPill />
    </span>
  )
}

function Group({
  group,
  open,
  mode,
  currentHref,
  onToggle,
  onExpandTo,
  onNavigate
}: {
  group: NavigationGroup
  open: boolean
  mode: Mode
  currentHref: string | null
  onToggle: () => void
  onExpandTo: () => void
  onNavigate?: () => void
}) {
  const id = useId()
  const Icon = navigationIcons[group.icon]
  const tip = useRailTip(group.label, mode === 'rail')
  if (mode === 'rail')
    return (
      <button
        {...tip}
        type="button"
        onClick={onExpandTo}
        aria-label={`${group.label}: expand the sidebar`}
        className={cn(
          rowClass,
          'justify-center px-0 hover:bg-[var(--surface-hover)] hover:text-[var(--nav-text)]'
        )}
      >
        <Icon className={iconClass} aria-hidden />
      </button>
    )
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`${id}-items`}
        className={cn(
          rowClass,
          'hover:bg-[var(--surface-hover)] hover:text-[var(--nav-text)]'
        )}
      >
        <Icon className={iconClass} aria-hidden />
        <span>{group.label}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            'ml-auto size-4 transition-transform motion-reduce:transition-none',
            open ? 'rotate-0' : '-rotate-90'
          )}
        />
      </button>
      <div id={`${id}-items`} hidden={!open} className="mt-1 space-y-1">
        {group.items.map((item) =>
          isSoon(item) ? (
            <SoonItem key={item.label} label={item.label} icon={item.icon} />
          ) : (
            <NavLink
              key={item.label}
              item={item}
              current={currentHref === item.href && firstLabelFor(group, item)}
              mode={mode}
              indent
              onNavigate={onNavigate}
            />
          )
        )}
      </div>
    </div>
  )
}

// Two entries may share a page (Holidays lives on Settings for now); only the
// first one is marked as the current page.
function firstLabelFor(group: NavigationGroup, item: NavigationItem) {
  const first = group.items.find(
    (other) => !isSoon(other) && other.href === item.href
  )
  return first?.label === item.label
}

function useDismiss(
  open: boolean,
  close: (returnFocus: boolean) => void,
  container: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(true)
    }
    const onPointer = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) close(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open, close, container])
}

// Profile lives at /profile (built by the other lane, spec §14); until then
// it is shown as coming soon. Connections is not repeated here: it is
// already in Workspace (OWNER_JOURNEYS.md §18.18).
function AccountLinks() {
  return (
    <>
      <span
        aria-disabled="true"
        className="flex min-h-10 cursor-not-allowed items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm text-[var(--text-faint)]"
      >
        <UserRound className="size-4" aria-hidden />
        <span>
          Profile Update
          <ComingSoon />
        </span>
        <SoonPill />
      </span>
      <div className="my-1 border-t border-[var(--line)]" />
      <form action={signOut}>
        <button
          type="submit"
          className="flex min-h-10 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm font-medium text-[var(--danger-ink)] hover:bg-[var(--danger-soft)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
        >
          <LogOut className="size-4" aria-hidden />
          Log out
        </button>
      </form>
    </>
  )
}

function Avatar({
  letter,
  round = false
}: {
  letter: string
  round?: boolean
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-9 shrink-0 place-items-center bg-[var(--brand-primary)] text-sm font-semibold text-[var(--on-brand)]',
        round ? 'rounded-full' : 'rounded-[var(--radius-small)]'
      )}
    >
      {letter}
    </span>
  )
}

function AccountMenu({
  identity,
  rail
}: {
  identity: ShellIdentity
  rail: boolean
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) trigger.current?.focus()
  }, [])
  useDismiss(open, close, container)
  const tip = useRailTip(identity.name, rail && !open)
  const letter = identity.initials.slice(0, 1) || identity.name.slice(0, 1)
  return (
    <div ref={container} className="relative">
      {open && (
        <div
          id={`${id}-menu`}
          className={cn(
            'absolute bottom-full z-30 mb-2 w-60 rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-[var(--surface-raised)] p-2 shadow-[0_8px_24px_-12px_rgb(17_17_17/0.25)]',
            rail ? 'left-0' : 'inset-x-0 w-auto'
          )}
        >
          <div className="border-b border-[var(--line)] px-3 pt-2 pb-3">
            <p className="text-sm font-semibold break-words">{identity.name}</p>
            {identity.email && (
              <p className="mt-0.5 text-xs break-all text-[var(--text-muted)]">
                {identity.email}
              </p>
            )}
          </div>
          <div className="pt-1">
            <AccountLinks />
          </div>
        </div>
      )}
      <button
        {...tip}
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        aria-label={`Open account menu for ${identity.name}`}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'group relative flex w-full items-center gap-3 rounded-[var(--radius-control)] p-2 text-left hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none',
          rail && 'justify-center p-1.5'
        )}
      >
        <Avatar letter={letter} round />
        {!rail && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                {identity.name}
              </span>
              {identity.email && (
                <span className="block truncate text-xs text-[var(--text-muted)]">
                  {identity.email}
                </span>
              )}
            </span>
            <ChevronsUpDown
              className="size-4 shrink-0 text-[var(--text-muted)]"
              aria-hidden
            />
          </>
        )}
      </button>
    </div>
  )
}

function SidebarContent({
  mode,
  navigation,
  contextLabel,
  workspaceName,
  identity,
  demo,
  state,
  onState,
  onNavigate,
  onClose
}: {
  mode: Mode
  navigation: ShellNavigation
  contextLabel: string
  workspaceName: string
  identity: ShellIdentity
  demo: boolean
  state: ShellState
  onState: (state: ShellState) => void
  onNavigate?: () => void
  onClose?: () => void
}) {
  const pathname = usePathname()
  const rail = mode === 'rail'
  const hideTip = useContext(RailTipContext)?.hide
  const currentHref =
    navigationLinks(navigation).find((item) =>
      isCurrentPath(pathname, item.href)
    )?.href ?? null
  const letter = workspaceName.trim().slice(0, 1).toUpperCase() || 'W'
  const toggleTip = useRailTip('Expand sidebar', rail)
  return (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          'flex items-center gap-3 border-b border-[var(--line)] px-3 py-4',
          rail && 'flex-col gap-2 px-2'
        )}
        data-testid={
          mode === 'drawer' ? 'shell-workspace-mobile' : 'shell-workspace'
        }
      >
        <Avatar letter={letter} />
        {!rail && (
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 truncate text-sm font-semibold text-[var(--nav-text)]">
              <span className="truncate">{workspaceName}</span>
              {demo && (
                <span className="tracking-label rounded-full border border-[var(--line-strong)] px-1.5 py-0.5 font-mono text-[0.625rem] leading-none text-[var(--text-muted)] uppercase">
                  Demo
                </span>
              )}
            </p>
            <p className="truncate text-xs text-[var(--nav-muted)]">
              {identity.name}
            </p>
          </div>
        )}
        {mode === 'drawer' ? (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-[var(--radius-control)] text-[var(--nav-muted)] hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
          >
            <X className="size-5" aria-hidden />
          </button>
        ) : (
          <button
            {...toggleTip}
            type="button"
            aria-label="Toggle sidebar"
            aria-expanded={!rail}
            onClick={() => onState({ ...state, collapsed: !rail })}
            className="group relative grid size-8 place-items-center rounded-[var(--radius-control)] text-[var(--nav-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--nav-text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
          >
            {rail ? (
              <ChevronRight className="size-4" aria-hidden />
            ) : (
              <ChevronLeft className="size-4" aria-hidden />
            )}
          </button>
        )}
      </div>
      <nav
        onScroll={hideTip}
        aria-label={`${contextLabel} ${mode === 'drawer' ? 'mobile navigation' : 'navigation'}`}
        className={cn(
          'flex-1 space-y-1 overflow-y-auto px-3 py-4',
          rail && 'px-2'
        )}
      >
        {navigation.primary.map((item) => (
          <NavLink
            key={item.label}
            item={item}
            current={currentHref === item.href}
            mode={mode}
            onNavigate={onNavigate}
          />
        ))}
        {navigation.groups.length > 0 && (
          <div className="my-3 border-t border-[var(--line)]" />
        )}
        {navigation.groups.map((group) => (
          <Group
            key={group.id}
            group={group}
            open={groupOpen(state, group.id, group.defaultOpen)}
            mode={mode}
            currentHref={currentHref}
            onNavigate={onNavigate}
            onToggle={() =>
              onState({
                ...state,
                groups: {
                  ...state.groups,
                  [group.id]: !groupOpen(state, group.id, group.defaultOpen)
                }
              })
            }
            onExpandTo={() =>
              onState({
                collapsed: false,
                groups: { ...state.groups, [group.id]: true }
              })
            }
          />
        ))}
      </nav>
      <div className={cn('border-t border-[var(--line)] p-3', rail && 'p-2')}>
        {mode === 'drawer' ? (
          <div className="space-y-1">
            <div className="flex items-center gap-3 px-2 pb-2">
              <Avatar
                letter={
                  identity.initials.slice(0, 1) || identity.name.slice(0, 1)
                }
                round
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {identity.name}
                </p>
                {identity.email && (
                  <p className="truncate text-xs text-[var(--text-muted)]">
                    {identity.email}
                  </p>
                )}
              </div>
            </div>
            <AccountLinks />
          </div>
        ) : (
          <AccountMenu identity={identity} rail={rail} />
        )}
      </div>
    </div>
  )
}

/**
 * The workspace frame (docs/UI_REBUILD_SPEC.md §2): a 255px sidebar that
 * collapses to a 56px icon rail on desktop, and a top bar with a drawer on
 * small screens. Collapse and group state persist across page loads.
 */
export function ShellFrame({
  navigation,
  contextLabel,
  workspaceName,
  identity,
  demo,
  initialState,
  style,
  children
}: {
  navigation: ShellNavigation
  contextLabel: string
  workspaceName: string
  identity: ShellIdentity
  demo: boolean
  initialState: ShellState
  style?: React.CSSProperties
  children: ReactNode
}) {
  const [state, setState] = useState(initialState)
  const [tip, setTip] = useState<RailTip | null>(null)
  const drawer = useRef<HTMLDialogElement>(null)
  const drawerId = useId()
  const update = (next: ShellState) => {
    setTip(null)
    setState(next)
    persist(next)
  }
  const tipControls = useMemo<RailTipControls>(
    () => ({
      show: (label, element) => {
        const box = element.getBoundingClientRect()
        setTip({ label, top: box.top + box.height / 2, left: box.right + 12 })
      },
      hide: () => setTip(null)
    }),
    []
  )
  useEffect(() => {
    if (!tip) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTip(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [tip])
  const shared = {
    navigation,
    contextLabel,
    workspaceName,
    identity,
    demo,
    state,
    onState: update
  }
  return (
    <div
      className="min-h-screen bg-[var(--surface)] font-sans text-[var(--text)]"
      style={style}
    >
      <a
        href="#main-content"
        className="fixed top-3 left-3 z-50 -translate-y-20 rounded-[var(--radius-control)] bg-[var(--text)] px-4 py-2 text-sm text-[var(--surface)] focus:translate-y-0"
      >
        Skip to content
      </a>
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-20 hidden border-r border-[var(--line)] bg-[var(--nav)] text-[var(--nav-text)] transition-[width] motion-reduce:transition-none lg:block',
          state.collapsed
            ? 'w-[var(--gr-sidebar-rail)]'
            : 'w-[var(--gr-sidebar-width)]'
        )}
      >
        <RailTipContext.Provider value={tipControls}>
          <SidebarContent
            {...shared}
            mode={state.collapsed ? 'rail' : 'full'}
          />
        </RailTipContext.Provider>
        {tip && state.collapsed && <RailTooltip tip={tip} />}
      </aside>
      <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b border-[var(--line)] bg-[var(--nav)] px-4 lg:hidden">
        <button
          type="button"
          aria-controls={drawerId}
          aria-label="Open navigation"
          onClick={() => drawer.current?.showModal()}
          className="grid size-10 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
        >
          <Menu className="size-5" aria-hidden />
        </button>
        <span className="min-w-0 truncate text-sm font-semibold">
          {workspaceName}
        </span>
      </header>
      <dialog
        ref={drawer}
        id={drawerId}
        aria-label={`${contextLabel} navigation menu`}
        className="fixed inset-y-0 left-0 m-0 h-dvh max-h-dvh w-[min(var(--gr-sidebar-width),calc(100vw-2rem))] max-w-none border-0 border-r border-[var(--line)] bg-[var(--nav)] p-0 text-[var(--nav-text)]"
      >
        <SidebarContent
          {...shared}
          mode="drawer"
          onNavigate={() => drawer.current?.close()}
          onClose={() => drawer.current?.close()}
        />
      </dialog>
      <div
        className={cn(
          'transition-[padding] motion-reduce:transition-none',
          state.collapsed
            ? 'lg:pl-[var(--gr-sidebar-rail)]'
            : 'lg:pl-[var(--gr-sidebar-width)]'
        )}
      >
        <main id="main-content" className="px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
          <div className="mx-auto w-full max-w-[var(--gr-content-max)]">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}

/**
 * Application shell: sidebar, business switcher, top bar, command palette.
 *
 * The layout is the one the plan asks for — a left sidebar with the business
 * switcher at the top, a top bar carrying global search and the command palette
 * (Cmd/Ctrl+K), and content to the right. Nothing in here knows anything about
 * invoicing; it is chrome.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Building2,
  ChevronDown,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Menu as MenuIcon,
  Moon,
  Package,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Settings,
  Sun,
  Users,
  Wand2,
  Clock,
  Bell,
  GitBranch,
  BarChart3,
  Landmark,
  Timer,
  ReceiptText,
  Briefcase,
  Wallet,
  Check,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { cn } from '@/ui/lib/cn';
import {
  Badge,
  Button,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  Tooltip,
  useMediaQuery,
} from '@/ui/components/base';
import { useAppStore } from '@/state/app';
import { commandRegistry } from '@/lib/commands';

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Count badge source, resolved from the store. */
  badge?: 'drafts' | 'overdue' | 'quotes' | 'reminders' | 'recurring';
  end?: boolean;
}

const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/invoices', label: 'Invoices', icon: Receipt, badge: 'drafts' },
  { to: '/quotes', label: 'Quotes', icon: FileText, badge: 'quotes' },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/items', label: 'Items', icon: Package },
];

const SECONDARY_NAV: NavItem[] = [
  { to: '/time', label: 'Time', icon: Timer },
  { to: '/expenses', label: 'Expenses', icon: ReceiptText },
  { to: '/projects', label: 'Projects', icon: Briefcase },
  { to: '/retainers', label: 'Retainers', icon: Wallet },
  { to: '/templates', label: 'Templates', icon: Wand2 },
  { to: '/recurring', label: 'Recurring', icon: Clock, badge: 'recurring' },
  { to: '/reminders', label: 'Reminders', icon: Bell, badge: 'reminders' },
  { to: '/rules', label: 'Rules', icon: GitBranch },
  { to: '/automation-log', label: 'Automation log', icon: RefreshCw },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/bank-import', label: 'Bank import', icon: Landmark },
];

const SETTINGS_NAV: NavItem[] = [{ to: '/settings', label: 'Settings', icon: Settings }];

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

export function AppShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isNarrow = useMediaQuery('(max-width: 900px)');
  const collapsed = useAppStore((s) => s.settings?.sidebarCollapsed ?? false);
  const saveSettings = useAppStore((s) => s.saveSettings);

  // With no business, the wizard is the only useful screen — a sidebar of links to
  // empty lists is a worse first impression than four questions. The wizard renders
  // without the shell.
  //
  // Settings is exempt because it has to be reachable before a business exists: a
  // restore from a JSON export is how somebody gets their data back onto a clean
  // install, and trapping them in the wizard would make that impossible. Each
  // settings section says so itself when it needs a business. `/style-guide` is
  // exempt because it is how the design system gets reviewed.
  const needsSetup = useAppStore((s) => s.profiles.length === 0);
  const location = useLocation();
  const exempt =
    location.pathname.startsWith('/setup') ||
    location.pathname.startsWith('/settings') ||
    location.pathname.startsWith('/style-guide');

  // Cmd/Ctrl+K opens the command palette; Cmd/Ctrl+N starts a new invoice —
  // the plan's shortcuts, wired at the shell so they work from any screen.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        navigate('/invoices/new');
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  const toggleCollapsed = useCallback(() => {
    if (isNarrow) {
      setSidebarOpen((v) => !v);
      return;
    }
    const settings = useAppStore.getState().settings;
    if (settings) void saveSettings({ ...settings, sidebarCollapsed: !collapsed });
  }, [collapsed, isNarrow, saveSettings]);

  // With no business, the wizard is the only useful screen — a sidebar of links to
  // empty lists is a worse first impression than four questions. The wizard renders
  // without the shell, and `/style-guide` stays reachable because it is how the
  // design system gets reviewed.
  if (needsSetup && !exempt) return <OnboardingRedirect />;

  return (
    <div className="flex h-dvh overflow-hidden bg-paper">
      {/* ---- sidebar ---- */}
      {!isNarrow && <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />}

      {/* Mobile drawer */}
      {isNarrow && sidebarOpen && (
        <div className="fixed inset-0 z-40 flex">
          <div
            className="animate-fade-in absolute inset-0 bg-ink/30"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
          <div className="animate-slide-in-right relative z-10 w-72">
            <Sidebar
              collapsed={false}
              onToggle={() => setSidebarOpen(false)}
              onNavigate={() => setSidebarOpen(false)}
            />
          </div>
        </div>
      )}

      {/* ---- main ---- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onOpenPalette={() => setPaletteOpen(true)}
          onToggleSidebar={toggleCollapsed}
          showSidebarToggle
        />
        <main className={cn('min-h-0 flex-1 overflow-y-auto scroll-quiet', isNarrow && 'pb-16')}>
          {children}
        </main>
        {isNarrow && <BottomNav />}
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

/**
 * Bottom navigation for phones — the plan's Phase 9 item 1.
 *
 * The desktop's sidebar is chrome a phone has no room for; the drawer behind
 * the top-bar toggle still reaches everything, and the bottom bar carries the
 * five destinations worth a thumb-tap. Large touch targets: the whole row is
 * 56 px tall and every tap zone is full-width.
 */
function BottomNav() {
  const items = [
    { to: '/', label: 'Home', icon: LayoutDashboard, end: true },
    { to: '/invoices', label: 'Invoices', icon: Receipt },
    { to: '/quotes', label: 'Quotes', icon: FileText },
    { to: '/clients', label: 'Clients', icon: Users },
    { to: '/time', label: 'Time', icon: Timer },
  ];
  return (
    <nav
      className="data-print:hide fixed inset-x-0 bottom-0 z-30 flex h-14 items-stretch border-t border-rule bg-paper-raised"
      aria-label="Phone navigation"
    >
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
              isActive ? 'text-accent' : 'text-ink-muted',
            )
          }
        >
          <item.icon className="size-5" aria-hidden />
          <span className="truncate">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * Sends a brand-new install to the wizard.
 *
 * `replace` so the empty dashboard is not in the history — otherwise Back lands on
 * a screen with nothing on it.
 */
function OnboardingRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/setup', { replace: true });
  }, [navigate]);
  return null;
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                             */
/* ------------------------------------------------------------------ */

function Sidebar({
  collapsed,
  onToggle,
  onNavigate,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  void onNavigate;
  const navigate = useNavigate();
  const documents = useAppStore((s) => s.documents);
  const quotes = useAppStore((s) => s.documents);
  const schedules = useAppStore((s) => s.recurringSchedules);
  const reminders = useAppStore((s) => s.reminders);
  const settings = useAppStore((s) => s.settings);

  const counts = useMemo(
    () => ({
      drafts: documents.filter((d) => d.type === 'invoice' && d.status === 'draft').length,
      overdue: documents.filter((d) => d.status === 'overdue').length,
      quotes: quotes.filter((d) => d.type === 'quote' && d.status !== 'void').length,
      reminders: reminders.filter((r) => r.status === 'pending').length,
      recurring: schedules.filter((s) => !s.paused).length,
    }),
    [documents, quotes, schedules, reminders],
  );

  const width = collapsed ? 'w-14' : 'w-60';

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-r border-rule bg-paper',
        width,
        'transition-[width] duration-150 ease-[cubic-bezier(0.2,0,0,1)]',
      )}
      data-print="hide"
    >
      {/* Brand and business switcher */}
      <div className={cn('flex items-center gap-2 px-2 py-2.5', collapsed && 'justify-center')}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-1">
            <Tooltip label="Duly — invoices, duly done" side="bottom">
              <BrandMark />
            </Tooltip>
            <IconButton label="Expand sidebar" size="sm" onClick={onToggle}>
              <PanelLeftOpen className="size-4" aria-hidden />
            </IconButton>
          </div>
        ) : (
          <>
            <BrandMark />
            <span className="font-display truncate text-[15px] font-semibold tracking-tight text-ink">
              Duly
            </span>
            <div className="ml-auto">
              <IconButton
                label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                size="sm"
                onClick={onToggle}
              >
                {collapsed ? (
                  <PanelLeftOpen className="size-4" aria-hidden />
                ) : (
                  <PanelLeftClose className="size-4" aria-hidden />
                )}
              </IconButton>
            </div>
          </>
        )}
      </div>

      <div className={cn('px-2 pb-2', collapsed && 'px-1')}>
        <BusinessSwitcher collapsed={collapsed} />
      </div>

      {/* New invoice, the action that has to be one click away */}
      <div className={cn('px-2 pb-2', collapsed && 'px-1')}>
        {collapsed ? (
          <Tooltip label="New invoice (⌘N)" side="right">
            <Button variant="primary" className="w-full px-0" onClick={() => navigate('/invoices/new')}>
              <Plus className="size-4" aria-hidden />
            </Button>
          </Tooltip>
        ) : (
          <Button
            variant="primary"
            fullWidth
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() => navigate('/invoices/new')}
          >
            New invoice
          </Button>
        )}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto scroll-quiet px-2 pb-2" aria-label="Main">
        <NavGroup items={PRIMARY_NAV} counts={counts} collapsed={collapsed} onNavigate={onNavigate} />
        <div className="my-2 h-px bg-rule" />
        <NavGroup items={SECONDARY_NAV} counts={counts} collapsed={collapsed} onNavigate={onNavigate} />
      </nav>

      <div className="border-t border-rule px-2 py-2">
        <NavGroup items={SETTINGS_NAV} counts={counts} collapsed={collapsed} onNavigate={onNavigate} />
        {collapsed && (
          <div className="mt-1 flex justify-center">
            <ThemeToggle collapsed />
          </div>
        )}
        {!collapsed && (
          <div className="mt-1 flex items-center justify-between px-1">
            <ThemeToggle collapsed={false} />
            <span className="text-[10px] text-ink-faint">v{settings?.lastSeenVersion || '0.1.0'}</span>
          </div>
        )}
      </div>
    </aside>
  );
}

function BrandMark() {
  return (
    <span
      className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-accent font-display text-[15px] leading-none font-semibold text-on-accent"
      aria-hidden
    >
      D
    </span>
  );
}

function NavGroup({
  items,
  counts,
  collapsed,
  onNavigate,
}: {
  items: NavItem[];
  counts: Record<string, number>;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => {
        const count = item.badge ? counts[item.badge] : 0;
        const Icon = item.icon;
        const link = (
          <NavLink
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-[13px] font-medium transition-colors',
                collapsed && 'justify-center px-0',
                isActive
                  ? 'bg-accent-soft text-ink'
                  : 'text-ink-muted hover:bg-paper-sunken hover:text-ink',
              )
            }
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
            {!collapsed && count > 0 && (
              <Badge className={cn(item.badge === 'overdue' && 'bg-overdue-soft text-overdue')}>
                {count}
              </Badge>
            )}
            {collapsed && count > 0 && (
              <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent" aria-hidden />
            )}
          </NavLink>
        );

        return (
          <li key={item.to} className="relative">
            {collapsed ? (
              <Tooltip label={item.label} side="right">
                {link}
              </Tooltip>
            ) : (
              link
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Business switcher                                                   */
/* ------------------------------------------------------------------ */

function BusinessSwitcher({ collapsed }: { collapsed: boolean }) {
  const profiles = useAppStore((s) => s.profiles);
  const activeProfileId = useAppStore((s) => s.activeProfileId);
  const setActiveProfile = useAppStore((s) => s.setActiveProfile);
  const navigate = useNavigate();
  const active = profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null;

  const trigger = (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-2 rounded-[8px] border border-rule bg-paper-raised px-2 py-1.5 text-left transition-colors hover:border-rule-strong',
        collapsed && 'justify-center px-0',
      )}
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-[5px] bg-paper-sunken text-ink-muted">
        <Building2 className="size-3.5" aria-hidden />
      </span>
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium text-ink">
              {active?.name ?? 'No business yet'}
            </span>
            {active && (
              <span className="block truncate text-[10px] text-ink-faint">
                {active.gstRegistered ? 'GST registered' : 'Not GST registered'}
              </span>
            )}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
        </>
      )}
    </button>
  );

  if (collapsed) {
    return (
      <Menu
        trigger={
          <Tooltip label={active?.name ?? 'Switch business'} side="right">
            {trigger}
          </Tooltip>
        }
      >
        {profiles.map((p) => (
          <MenuItem
            key={p.id}
            icon={
              p.id === active?.id ? (
                <Check className="size-3.5 text-accent" aria-hidden />
              ) : (
                <Building2 className="size-3.5" aria-hidden />
              )
            }
            onClick={() => void setActiveProfile(p.id)}
          >
            {p.name}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem
          icon={<Plus className="size-3.5" aria-hidden />}
          onClick={() => navigate('/settings/profiles')}
        >
          Add a business
        </MenuItem>
      </Menu>
    );
  }

  return (
    <Menu trigger={trigger}>
      {profiles.map((p) => (
        <MenuItem
          key={p.id}
          icon={
            p.id === active?.id ? (
              <Check className="size-3.5 text-accent" aria-hidden />
            ) : (
              <Building2 className="size-3.5" aria-hidden />
            )
          }
          onClick={() => void setActiveProfile(p.id)}
        >
          <span className="flex items-center gap-2">
            <span className="truncate">{p.name}</span>
            <span className="ml-auto shrink-0 text-[10px] text-ink-faint">{p.defaultCurrency}</span>
          </span>
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem
        icon={<Plus className="size-3.5" aria-hidden />}
        onClick={() => navigate('/settings/profiles')}
      >
        Add a business
      </MenuItem>
      <MenuItem
        icon={<Settings className="size-3.5" aria-hidden />}
        onClick={() => navigate('/settings/profiles')}
      >
        Business settings
      </MenuItem>
    </Menu>
  );
}

/* ------------------------------------------------------------------ */
/* Top bar                                                             */
/* ------------------------------------------------------------------ */

function TopBar({
  onOpenPalette,
  onToggleSidebar,
  showSidebarToggle,
}: {
  onOpenPalette: () => void;
  onToggleSidebar: () => void;
  showSidebarToggle?: boolean;
}) {
  const navigate = useNavigate();
  const isNarrow = useMediaQuery('(max-width: 900px)');

  return (
    <header
      className="flex h-12 shrink-0 items-center gap-2 border-b border-rule bg-paper px-3"
      data-print="hide"
    >
      {showSidebarToggle && isNarrow && (
        <IconButton label="Open menu" onClick={onToggleSidebar}>
          <MenuIcon className="size-4" aria-hidden />
        </IconButton>
      )}

      <button
        type="button"
        onClick={onOpenPalette}
        className="group flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[8px] border border-rule bg-paper-raised px-2.5 text-left text-[13px] text-ink-faint transition-colors hover:border-rule-strong sm:max-w-md"
      >
        <Search className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">Search or jump to…</span>
        <kbd className="hidden shrink-0 rounded-[4px] border border-rule bg-paper-sunken px-1.5 py-0.5 font-mono text-[10px] sm:block">
          {typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '')
            ? '⌘K'
            : 'Ctrl K'}
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        {!isNarrow && (
          <Button
            size="sm"
            variant="ghost"
            icon={<FolderOpen className="size-3.5" aria-hidden />}
            onClick={() => navigate('/settings/files')}
          >
            Output folder
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={<Plus className="size-3.5" aria-hidden />}
          onClick={() => navigate('/invoices/new')}
        >
          {!isNarrow && 'New'}
        </Button>
        <ThemeToggle collapsed={false} />
      </div>
    </header>
  );
}

function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  const theme = useAppStore((s) => s.settings?.theme ?? 'system');
  const saveSettings = useAppStore((s) => s.saveSettings);

  const isDark =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  const toggle = () => {
    const settings = useAppStore.getState().settings;
    if (!settings) return;
    void saveSettings({ ...settings, theme: isDark ? 'light' : 'dark' });
  };

  const control = (
    <IconButton label={isDark ? 'Switch to light mode' : 'Switch to dark mode'} size="sm" onClick={toggle}>
      {isDark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </IconButton>
  );

  return collapsed ? (
    <Tooltip label={isDark ? 'Light mode' : 'Dark mode'} side="right">
      {control}
    </Tooltip>
  ) : (
    control
  );
}

/* ------------------------------------------------------------------ */
/* Command palette                                                     */
/* ------------------------------------------------------------------ */

/**
 * The command palette.
 *
 * "Jump anywhere or run any action" — new invoice for a client, open a document,
 * go to a screen, change a setting. Fuzzy matching is a simple subsequence score,
 * which is enough for a few dozen commands and needs no index.
 */
function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const clients = useAppStore((s) => s.clients);
  const documents = useAppStore((s) => s.documents);

  const commands = useMemo(
    () => commandRegistry({ clients, documents, navigate }),
    [clients, documents, navigate],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.slice(0, 40);
    return commands
      .map((c) => ({ command: c, score: fuzzyScore(`${c.label} ${c.group ?? ''} ${c.keywords ?? ''}`, q) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((r) => r.command);
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => setSelected(0), [query]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((i) => Math.min(results.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const command = results[selected];
        if (command) {
          command.run();
          onClose();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, results, selected, onClose]);

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div
        className="animate-fade-in absolute inset-0 bg-ink/25 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="sheet animate-scale-in relative z-10 w-full max-w-xl overflow-hidden"
      >
        <div className="flex items-center gap-2 border-b border-rule px-3">
          <Search className="size-4 shrink-0 text-ink-faint" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to anything, or type a client name…"
            aria-label="Search commands"
            className="h-12 min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <kbd className="shrink-0 rounded-[4px] border border-rule bg-paper-sunken px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
            esc
          </kbd>
        </div>

        <div
          ref={listRef}
          className="max-h-[50vh] overflow-y-auto scroll-quiet p-1"
          role="listbox"
          aria-label="Commands"
        >
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] text-ink-muted">
              Nothing matches “{query}”. Try a client name, a document number, or a screen.
            </p>
          ) : (
            results.map((command, index) => (
              <button
                key={command.id}
                type="button"
                role="option"
                aria-selected={index === selected}
                data-selected={index === selected}
                onMouseEnter={() => setSelected(index)}
                onClick={() => {
                  command.run();
                  onClose();
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-left transition-colors',
                  index === selected ? 'bg-accent-soft' : 'hover:bg-paper-sunken',
                )}
              >
                <span className="shrink-0 text-ink-faint">
                  {command.icon ?? <FileText className="size-4" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{command.label}</span>
                  {command.hint && (
                    <span className="block truncate text-[11px] text-ink-muted">{command.hint}</span>
                  )}
                </span>
                {command.group && (
                  <span className="shrink-0 text-[10px] text-ink-faint">{command.group}</span>
                )}
                {command.shortcut && (
                  <kbd className="shrink-0 rounded-[4px] border border-rule bg-paper-sunken px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
                    {command.shortcut}
                  </kbd>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Subsequence fuzzy match.
 *
 * Returns 0 for no match, otherwise a score where consecutive matches and
 * word-start matches score higher, so "ni acme" finds "New invoice for Acme".
 */
export function fuzzyScore(text: string, query: string): number {
  if (!query) return 1;
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();

  const exact = haystack.indexOf(needle);
  if (exact === 0) return 1000;
  if (exact > 0) return 500 - exact;

  let score = 0;
  let index = 0;
  let consecutive = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, index);
    if (found === -1) return 0;
    consecutive = found === index ? consecutive + 1 : 0;
    score += 10 + consecutive * 5;
    if (found === 0 || haystack[found - 1] === ' ') score += 8;
    index = found + 1;
  }
  return score;
}

/**
 * Layout.tsx — merged AppShell + Header + Sidebar in one file.
 * Used by App.tsx as the single shell wrapping all protected routes.
 */
import { useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Briefcase, List,
  CalendarDays, ShieldCheck, Scale, LogOut, ChevronLeft, ChevronRight, X, Menu, Info, Upload,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { OrgCreditWidget } from '@/components/OrgCreditWidget';

// ── Nav items ─────────────────────────────────────────────────────────────────

const NAV_GROUPS: { heading: string; items: { to: string; label: string; icon: typeof LayoutDashboard }[] }[] = [
  {
    heading: 'Overview',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    heading: 'Litigation',
    items: [
      { to: '/cases', label: 'Cases', icon: Briefcase },
      { to: '/todays-listings', label: "Today's Listings", icon: List },
      { to: '/upcoming-hearings', label: 'Upcoming Hearings', icon: CalendarDays },
    ],
  },
  {
    heading: 'Workspace',
    items: [
      { to: '/bulk-upload', label: 'Bulk Upload', icon: Upload },
      { to: '/administration', label: 'Administration', icon: ShieldCheck },
      { to: '/about', label: 'About', icon: Info },
    ],
  },
];

const PAGE_TITLES: Record<string, string> = {
  '/dashboard':       'Dashboard',
  '/cases':           'Case Management',
  '/todays-listings': "Today's Listings",
  '/upcoming-hearings': 'Upcoming Hearings',
  '/bulk-upload':      'Bulk Upload',
  '/administration':  'Administration',
  '/organizations':   'Organization Management',
  '/about':           'About',
};

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({
  mobileOpen,
  onMobileClose,
}: {
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/40 transition-opacity lg:hidden',
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onMobileClose}
      />

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-sidebar text-sidebar-foreground shadow-2xl transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 lg:shadow-none',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed ? 'lg:w-[4.5rem]' : 'lg:w-64',
        )}
      >
        {/* Mobile close button */}
        <button
          onClick={onMobileClose}
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground lg:hidden"
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Logo */}
        <div className={cn('flex items-center gap-3 border-b border-sidebar-border/70 px-4 py-[1.15rem]', collapsed && 'justify-center px-2')}>
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-900/50 ring-1 ring-white/10">
            <Scale className="h-5 w-5 text-white" />
          </div>
          {!collapsed && (
            <div className="overflow-hidden pr-8 lg:pr-0">
              <p className="truncate text-sm font-bold leading-tight tracking-tight">Adalat360</p>
              <p className="truncate text-[11px] text-sidebar-foreground/55">Government Litigation Platform</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-5">
          {NAV_GROUPS.map((group) => (
            <div key={group.heading} className="space-y-1">
              {!collapsed && (
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/40">
                  {group.heading}
                </p>
              )}
              {group.items.map(({ to, label, icon: Icon }) => {
                const isActive = location.pathname === to || location.pathname.startsWith(to + '/');
                return (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={onMobileClose}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150',
                      isActive
                        ? 'bg-sidebar-accent text-white shadow-sm'
                        : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                      collapsed && 'justify-center px-2',
                    )}
                    title={collapsed ? label : undefined}
                  >
                    {isActive && (
                      <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-gradient-to-b from-blue-400 to-indigo-400" aria-hidden="true" />
                    )}
                    <Icon className={cn('h-[1.05rem] w-[1.05rem] flex-shrink-0 transition-transform duration-150 group-hover:scale-110', isActive ? 'text-blue-300' : 'text-sidebar-foreground/60 group-hover:text-sidebar-foreground')} />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        {/* User & Logout */}
        <div className="space-y-1.5 border-t border-sidebar-border/70 p-3">
          {!collapsed && (
            <div className="flex items-center gap-2.5 rounded-lg bg-sidebar-accent/40 px-2.5 py-2">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-semibold text-white ring-1 ring-white/10">
                {user?.profile.full_name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold leading-tight">{user?.profile.full_name}</p>
                <p className="truncate text-[10px] capitalize text-sidebar-foreground/55">{user?.profile.role}</p>
              </div>
            </div>
          )}
          <button
            onClick={() => { onMobileClose(); logout(); }}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/65 transition-colors hover:bg-rose-500/15 hover:text-rose-200',
              collapsed && 'justify-center px-2',
            )}
            title="Logout"
          >
            <LogOut className="h-[1.05rem] w-[1.05rem] flex-shrink-0" />
            {!collapsed && <span>Logout</span>}
          </button>
          {!collapsed && (
            <p className="px-2 pt-1 text-center text-[10px] text-sidebar-foreground/35">Powered by Adalat360</p>
          )}
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-20 z-10 hidden h-6 w-6 items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-sidebar-foreground/60 shadow-md transition-colors hover:text-sidebar-foreground lg:flex"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
        </button>
      </aside>
    </>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function Header({ title, onMenuClick }: { title: string; onMenuClick: () => void }) {
  const { user } = useAuth();
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border/70 glass px-3 py-3 sm:px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onMenuClick}
          className="h-10 w-10 lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-foreground sm:text-lg lg:text-xl">{title}</h1>
          <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <OrgCreditWidget />
        <div className="flex items-center gap-2 border-l border-border/70 pl-2 sm:pl-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-semibold text-white shadow-sm ring-1 ring-white/20">
            {user?.profile.full_name.charAt(0).toUpperCase()}
          </div>
          <div className="hidden md:block">
            <p className="text-sm font-semibold leading-tight">{user?.profile.full_name}</p>
            <p className="text-xs capitalize text-muted-foreground">{user?.profile.role}</p>
          </div>
        </div>
      </div>
    </header>
  );
}

// ── Layout (AppShell) ─────────────────────────────────────────────────────────

export function Layout() {
  const location = useLocation();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const title =
    Object.entries(PAGE_TITLES).find(
      ([path]) => location.pathname === path || location.pathname.startsWith(path + '/'),
    )?.[1] ?? 'Adalat360';

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar mobileOpen={mobileSidebarOpen} onMobileClose={() => setMobileSidebarOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header title={title} onMenuClick={() => setMobileSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-slate-50/70 p-3 sm:p-4 lg:p-6">
          <div className="mx-auto w-full max-w-[1600px] animate-in-fade">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

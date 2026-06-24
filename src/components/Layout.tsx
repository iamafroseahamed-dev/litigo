/**
 * Layout.tsx — merged AppShell + Header + Sidebar in one file.
 * Used by App.tsx as the single shell wrapping all protected routes.
 */
import { useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Briefcase, List,
  CalendarDays, Settings, Scale, LogOut, ChevronLeft, ChevronRight, X, Menu, Info, Building2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { AppFooter } from '@/components/AppFooter';
import { OrgCreditWidget } from '@/components/OrgCreditWidget';

// ── Nav items ─────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { to: '/dashboard',       label: 'Dashboard',         icon: LayoutDashboard },
  { to: '/cases',           label: 'Cases',             icon: Briefcase },
  { to: '/todays-listings', label: "Today's Listings", icon: List },
  { to: '/upcoming-hearings', label: 'Upcoming Hearings', icon: CalendarDays },
  { to: '/settings',        label: 'Settings',          icon: Settings },
  { to: '/about',           label: 'About',             icon: Info },
];

const PAGE_TITLES: Record<string, string> = {
  '/dashboard':       'Dashboard',
  '/cases':           'Case Management',
  '/todays-listings': "Today's Listings",
  '/upcoming-hearings': 'Upcoming Hearings',
  '/settings':        'Settings',
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
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-sidebar text-sidebar-foreground shadow-xl transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 lg:shadow-none',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed ? 'lg:w-16' : 'lg:w-64',
        )}
      >
        {/* Mobile close button */}
        <button
          onClick={onMobileClose}
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground lg:hidden"
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Logo */}
        <div className={cn('flex items-center gap-3 border-b border-sidebar-border px-4 py-5', collapsed && 'justify-center')}>
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-500">
            <Scale className="h-5 w-5 text-white" />
          </div>
          {!collapsed && (
            <div className="overflow-hidden pr-8 lg:pr-0">
              <p className="truncate text-sm font-bold leading-tight">Adalat360</p>
              <p className="truncate text-xs text-sidebar-foreground/60">Government Litigation Platform</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-4">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
            const isActive = location.pathname === to || location.pathname.startsWith(to + '/');
            return (
              <NavLink
                key={to}
                to={to}
                onClick={onMobileClose}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-sidebar-accent text-white'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                  collapsed && 'justify-center px-2',
                )}
                title={collapsed ? label : undefined}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {!collapsed && <span>{label}</span>}
              </NavLink>
            );
          })}
        </nav>

        {/* User & Logout */}
        <div className="space-y-2 border-t border-sidebar-border p-3">
          {!collapsed && (
            <div className="px-2 py-1">
              <p className="truncate text-xs font-medium">{user?.profile.full_name}</p>
              <p className="truncate text-xs text-sidebar-foreground/60 capitalize">{user?.profile.role}</p>
            </div>
          )}
          <button
            onClick={() => { onMobileClose(); logout(); }}
            className={cn(
              'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
              collapsed && 'justify-center px-2',
            )}
            title="Logout"
          >
            <LogOut className="h-4 w-4 flex-shrink-0" />
            {!collapsed && <span>Logout</span>}
          </button>
          {!collapsed && (
            <p className="px-2 pt-1 text-center text-[10px] text-sidebar-foreground/40">Powered by Adalat360</p>
          )}
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-20 z-10 hidden h-6 w-6 items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-sidebar-foreground/60 hover:text-sidebar-foreground lg:flex"
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
    <header className="flex items-center justify-between gap-3 border-b bg-white px-3 py-3 sm:px-4 lg:px-6">
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
          <h1 className="truncate text-base font-semibold text-foreground sm:text-lg lg:text-xl">{title}</h1>
          <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <OrgCreditWidget />
        <div className="flex items-center gap-2 border-l pl-2 sm:pl-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            {user?.profile.full_name.charAt(0).toUpperCase()}
          </div>
          <div className="hidden md:block">
            <p className="text-sm font-medium leading-tight">{user?.profile.full_name}</p>
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

  // The About page shows the developer details inside its own card, so the global
  // footer is hidden there to avoid duplicating the attribution.
  const hideFooter = location.pathname === '/about';

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar mobileOpen={mobileSidebarOpen} onMobileClose={() => setMobileSidebarOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header title={title} onMenuClick={() => setMobileSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto bg-gray-50 p-3 sm:p-4 lg:p-6">
          <Outlet />
          {!hideFooter && <AppFooter className="mt-6 border-t pt-4" />}
        </main>
      </div>
    </div>
  );
}

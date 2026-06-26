import type { ReactElement } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { useOrg } from '@/lib/orgContext';
import { hasPermission, type AppPermission } from '@/lib/access';
import { AccessDenied } from '@/components/AccessDenied';

export function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  return user ? <Outlet /> : <Navigate to="/login" replace />;
}

export function PublicRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to="/dashboard" replace /> : <Outlet />;
}

export function RequirePermission({
  permission,
  message,
  children,
}: {
  permission: AppPermission;
  message?: string;
  children: ReactElement;
}) {
  const { role } = useOrg();
  if (!hasPermission(role, permission)) {
    return <AccessDenied message={message} />;
  }
  return children;
}

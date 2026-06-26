import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/lib/auth';
import { OrgProvider } from '@/lib/orgContext';
import { ProtectedRoute, PublicRoute, RequirePermission } from '@/components/ProtectedRoute';
import { Layout } from '@/components/Layout';
import { Skeleton } from '@/components/ui/skeleton';

// Analytics auto-refresh every 5 minutes without a page reload
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Route-level code splitting — each page is a separate chunk loaded on demand
const Login          = lazy(() => import('@/pages/Login'));
const Dashboard      = lazy(() => import('@/pages/Dashboard'));
const Cases          = lazy(() => import('@/pages/Cases'));
const TodaysListings  = lazy(() => import('@/pages/TodaysListings'));
const UpcomingHearings = lazy(() => import('@/pages/UpcomingHearings'));
const Administration  = lazy(() => import('@/pages/Administration'));
const Organizations  = lazy(() => import('@/pages/Organizations'));
const BulkUpload     = lazy(() => import('@/pages/BulkUpload'));
const About          = lazy(() => import('@/pages/About'));

function PageLoader() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <OrgProvider>
          <BrowserRouter>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                {/* Public */}
                <Route element={<PublicRoute />}>
                  <Route path="/login" element={<Login />} />
                </Route>

                {/* Protected */}
                <Route element={<ProtectedRoute />}>
                  <Route element={<Layout />}>
                    <Route path="/dashboard" element={(
                      <RequirePermission permission="dashboard:view">
                        <Dashboard />
                      </RequirePermission>
                    )} />
                    <Route path="/cases" element={(
                      <RequirePermission permission="cases:view">
                        <Cases />
                      </RequirePermission>
                    )} />
                    <Route path="/todays-listings" element={(
                      <RequirePermission permission="hearings:view">
                        <TodaysListings />
                      </RequirePermission>
                    )} />
                    <Route path="/upcoming-hearings" element={(
                      <RequirePermission permission="hearings:view">
                        <UpcomingHearings />
                      </RequirePermission>
                    )} />
                    <Route path="/administration" element={(
                      <RequirePermission permission="administration:view">
                        <Administration />
                      </RequirePermission>
                    )} />
                    <Route path="/settings"        element={<Navigate to="/administration" replace />} />
                    <Route path="/organizations" element={(
                      <RequirePermission permission="organizations:manage">
                        <Organizations />
                      </RequirePermission>
                    )} />
                    <Route path="/bulk-upload" element={(
                      <RequirePermission permission="bulk-upload:manage">
                        <BulkUpload />
                      </RequirePermission>
                    )} />
                    <Route path="/about"           element={<About />} />
                  </Route>
                </Route>

                {/* Fallback */}
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </OrgProvider>
        <Toaster richColors position="top-right" expand={true} duration={4000} />
      </AuthProvider>
    </QueryClientProvider>
  );
}

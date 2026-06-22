import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Analytics } from '@vercel/analytics/react';
import { AuthProvider } from '@/lib/auth';
import { ProtectedRoute, PublicRoute } from '@/components/ProtectedRoute';
import { Layout } from '@/components/Layout';
import { Skeleton } from '@/components/ui/skeleton';

// Route-level code splitting — each page is a separate chunk loaded on demand
const Login          = lazy(() => import('@/pages/Login'));
const Dashboard      = lazy(() => import('@/pages/Dashboard'));
const Cases          = lazy(() => import('@/pages/Cases'));
const TodaysListings  = lazy(() => import('@/pages/TodaysListings'));
const Settings       = lazy(() => import('@/pages/Settings'));

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
    <AuthProvider>
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
                <Route path="/dashboard"       element={<Dashboard />} />
                <Route path="/cases"           element={<Cases />} />
                <Route path="/todays-listings" element={<TodaysListings />} />
                <Route path="/settings"        element={<Settings />} />
              </Route>
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
      <Toaster richColors position="top-right" expand={true} duration={4000} />
      <Analytics />
    </AuthProvider>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertTriangle,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  Clock,
  Moon,
} from 'lucide-react';
import type { Case } from '@/types';




function isoToday(): string {
  return new Date().toISOString().split('T')[0];
}

function isoInNDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cases, setCases] = useState<Case[]>([]);
  const [todaysListings, setTodaysListings] = useState(0);
  const [upcomingCount, setUpcomingCount] = useState(0);

  const today = useMemo(() => isoToday(), []);
  const in7 = useMemo(() => isoInNDays(7), []);
  const tomorrow = useMemo(() => isoInNDays(1), []);

  useEffect(() => {
    async function fetchDashboardAnalytics() {
      setLoading(true);
      setError(null);
      try {
        const [casesRes, listingsRes] = await Promise.all([
          supabase
            .from('cases')
            .select('id,case_status,next_hearing_date,sensitivity,cla_party_status,district')
            .eq('active', true),
          supabase
            .from('today_matched_listings')
            .select('id', { count: 'exact', head: true })
            .eq('listed_date', today),
        ]);

        if (casesRes.error) throw casesRes.error;
        if (listingsRes.error) throw listingsRes.error;

        const fetchedCases = (casesRes.data ?? []) as Case[];
        setCases(fetchedCases);
        setTodaysListings(listingsRes.count ?? 0);

        const upcoming = fetchedCases.filter(
          (c) =>
            !!c.next_hearing_date
            && c.next_hearing_date >= today
            && c.next_hearing_date <= in7,
        );
        setUpcomingCount(upcoming.length);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load dashboard KPI.');
      } finally {
        setLoading(false);
      }
    }

    void fetchDashboardAnalytics();
  }, [today, in7]);

  const pending = useMemo(() => cases.filter((c) => c.case_status === 'Pending'), [cases]);
  const disposed = useMemo(() => cases.filter((c) => c.case_status === 'Disposed'), [cases]);
  const hearingsTomorrow = useMemo(
    () => cases.filter((c) => c.next_hearing_date === tomorrow),
    [cases, tomorrow],
  );
  const hearingsIn7 = useMemo(
    () =>
      cases.filter(
        (c) =>
          !!c.next_hearing_date
          && c.next_hearing_date >= today
          && c.next_hearing_date <= in7,
      ),
    [cases, today, in7],
  );
  const dormant = useMemo(
    () =>
      cases.filter(
        (c) =>
          c.case_status === 'Pending'
          && (!c.next_hearing_date || c.next_hearing_date < today),
      ),
    [cases, today],
  );

  const bySensitivity = useMemo(() => {
    const map = new Map<string, number>();
    cases.forEach((c) => {
      const key = c.sensitivity || '(blank)';
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [cases]);

  const byCla = useMemo(() => {
    const map = new Map<string, number>();
    cases.forEach((c) => {
      const key = c.cla_party_status || '(blank)';
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [cases]);

  const pendingByDistrict = useMemo(() => {
    const map = new Map<string, number>();
    pending.forEach((c) => {
      const key = c.district || '(blank)';
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [pending]);

  const disposedByDistrict = useMemo(() => {
    const map = new Map<string, number>();
    disposed.forEach((c) => {
      const key = c.district || '(blank)';
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [disposed]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Executive summary</p>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {!loading && hearingsIn7.length > 0 && (
        <div className="flex flex-wrap items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">
            <strong>Alert:</strong> {hearingsIn7.length} pending case{hearingsIn7.length !== 1 ? 's' : ''} have hearings within 7 days.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground">Cases Under Management</p>
            {loading ? <Skeleton className="mt-2 h-8 w-16" /> : <p className="mt-1 text-3xl font-bold text-amber-600">{pending.length}</p>}
            <Briefcase className="mt-2 h-4 w-4 text-amber-600" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground">Disposed / Closed</p>
            {loading ? <Skeleton className="mt-2 h-8 w-16" /> : <p className="mt-1 text-3xl font-bold text-emerald-600">{disposed.length}</p>}
            <CheckCircle2 className="mt-2 h-4 w-4 text-emerald-600" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground">Today's Court Listings</p>
            {loading ? <Skeleton className="mt-2 h-8 w-16" /> : <p className="mt-1 text-3xl font-bold text-blue-600">{todaysListings}</p>}
            <CalendarDays className="mt-2 h-4 w-4 text-blue-600" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground">Tomorrow's Hearings</p>
            {loading ? <Skeleton className="mt-2 h-8 w-16" /> : <p className="mt-1 text-3xl font-bold text-indigo-600">{hearingsTomorrow.length}</p>}
            <Clock className="mt-2 h-4 w-4 text-indigo-600" />
          </CardContent>
        </Card>
        <button
          type="button"
          onClick={() => navigate('/upcoming-hearings')}
          className="text-left"
          aria-label="Open upcoming hearings"
        >
          <Card className="h-full transition-colors hover:bg-muted/40">
            <CardContent className="p-5">
              <p className="text-sm font-medium text-muted-foreground">Upcoming Hearings (7 Days)</p>
              {loading ? <Skeleton className="mt-2 h-8 w-16" /> : <p className="mt-1 text-3xl font-bold text-orange-600">{upcomingCount}</p>}
              <CalendarDays className="mt-2 h-4 w-4 text-orange-600" />
            </CardContent>
          </Card>
        </button>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground">Dormant Cases</p>
            {loading ? <Skeleton className="mt-2 h-8 w-16" /> : <p className="mt-1 text-3xl font-bold text-red-600">{dormant.length}</p>}
            <Moon className="mt-2 h-4 w-4 text-red-600" />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">By Sensitivity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              [1, 2, 3].map((i) => <Skeleton key={i} className="h-6" />)
            ) : bySensitivity.length === 0 ? (
              <p className="text-xs text-muted-foreground">No data.</p>
            ) : (
              bySensitivity.map(([label, count]) => (
                <div key={label} className="flex items-center justify-between text-sm">
                  <span className="truncate">{label}</span>
                  <Badge variant="outline">{count}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">By CLA Party Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              [1, 2, 3].map((i) => <Skeleton key={i} className="h-6" />)
            ) : byCla.length === 0 ? (
              <p className="text-xs text-muted-foreground">No data.</p>
            ) : (
              byCla.map(([label, count]) => (
                <div key={label} className="flex items-center justify-between text-sm">
                  <span className="truncate">{label}</span>
                  <Badge variant="outline">{count}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pending Cases by District</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              [1, 2, 3].map((i) => <Skeleton key={i} className="h-6" />)
            ) : pendingByDistrict.length === 0 ? (
              <p className="text-xs text-muted-foreground">No pending cases.</p>
            ) : (
              pendingByDistrict.map(([district, count]) => (
                <div key={district} className="flex items-center justify-between text-sm">
                  <span className="truncate">{district}</span>
                  <Badge variant="warning">{count}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Disposed Cases by District</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              [1, 2, 3].map((i) => <Skeleton key={i} className="h-6" />)
            ) : disposedByDistrict.length === 0 ? (
              <p className="text-xs text-muted-foreground">No disposed cases.</p>
            ) : (
              disposedByDistrict.map(([district, count]) => (
                <div key={district} className="flex items-center justify-between text-sm">
                  <span className="truncate">{district}</span>
                  <Badge variant="success">{count}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

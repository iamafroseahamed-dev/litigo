import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CalendarDays } from 'lucide-react';

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
  const [upcomingCount, setUpcomingCount] = useState(0);

  const today = useMemo(() => isoToday(), []);
  const in7 = useMemo(() => isoInNDays(7), []);

  useEffect(() => {
    async function fetchUpcomingCount() {
      setLoading(true);
      setError(null);
      try {
        const { count, error: sbErr } = await supabase
          .from('cases')
          .select('id', { count: 'exact', head: true })
          .eq('active', true)
          .gte('next_hearing_date', today)
          .lte('next_hearing_date', in7);

        if (sbErr) throw sbErr;
        setUpcomingCount(count ?? 0);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load dashboard KPI.');
      } finally {
        setLoading(false);
      }
    }

    void fetchUpcomingCount();
  }, [today, in7]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Executive summary</p>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <button
        type="button"
        onClick={() => navigate('/upcoming-hearings')}
        className="w-full text-left"
        aria-label="Open upcoming hearings"
      >
        <Card className="transition-colors hover:bg-muted/40">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Upcoming Hearings (7 Days)</p>
                {loading ? (
                  <Skeleton className="mt-2 h-8 w-16" />
                ) : (
                  <p className="mt-1 text-3xl font-bold text-orange-600">{upcomingCount.toLocaleString()}</p>
                )}
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-orange-100">
                <CalendarDays className="h-5 w-5 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </button>
    </div>
  );
}

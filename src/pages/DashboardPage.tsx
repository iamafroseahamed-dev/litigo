import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Briefcase, List, GitCompare, Bell, XCircle, Clock, CheckCircle2, AlertCircle } from 'lucide-react';

function MetricCard({
  title, value, icon: Icon, color, subtitle,
}: {
  title: string; value: number; icon: React.ElementType; color: string; subtitle?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 sm:p-5 lg:p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className={`mt-1 text-2xl font-bold sm:text-3xl ${color}`}>{value.toLocaleString()}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          <div className={`flex h-10 w-10 items-center justify-center rounded-full bg-opacity-10 sm:h-12 sm:w-12 ${color.replace('text-', 'bg-').replace('-600', '-100').replace('-500', '-100')}`}>
            <Icon className={`h-5 w-5 sm:h-6 sm:w-6 ${color}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricCard title="Active Cases" value={0} icon={Briefcase} color="text-blue-600" />
        <MetricCard title="Cause List Today" value={0} icon={List} color="text-purple-600" />
        <MetricCard title="Matched Today" value={0} icon={GitCompare} color="text-emerald-600" />
        <MetricCard title="Alerts Generated" value={0} icon={Bell} color="text-amber-600" />
        <MetricCard title="Failed Alerts" value={0} icon={XCircle} color="text-red-600" />
        <MetricCard title="Pending Alerts" value={0} icon={Clock} color="text-orange-500" />
        <MetricCard title="Sent Alerts" value={0} icon={CheckCircle2} color="text-green-600" />
        <MetricCard title="Upcoming Hearings" value={0} icon={AlertCircle} color="text-indigo-600" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">No activity yet.</p>
        </CardContent>
      </Card>
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { BellRing, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import type { NotificationDeliveryLog } from '@/types';

function fmtDatetime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'sent')    return <Badge variant="success">Sent</Badge>;
  if (status === 'failed')  return <Badge variant="destructive">Failed</Badge>;
  if (status === 'pending') return <Badge variant="warning">Pending</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function ChannelBadge({ channel }: { channel: string }) {
  if (channel === 'email')     return <Badge variant="outline" className="text-[10px]">Email</Badge>;
  if (channel === 'sms')       return <Badge variant="outline" className="text-[10px]">SMS</Badge>;
  if (channel === 'whatsapp')  return <Badge variant="outline" className="text-[10px]">WhatsApp</Badge>;
  return <Badge variant="outline" className="text-[10px]">{channel}</Badge>;
}

export default function Notifications() {
  const [logs, setLogs] = useState<NotificationDeliveryLog[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('notification_delivery_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    setLogs((data ?? []) as NotificationDeliveryLog[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const sentCount    = logs.filter(l => l.status === 'sent').length;
  const failedCount  = logs.filter(l => l.status === 'failed').length;
  const pendingCount = logs.filter(l => l.status === 'pending').length;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Notification Center</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Review all case hearing alert delivery records.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="pt-4 pb-4">
          <p className="text-xs text-muted-foreground">Sent</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600">{sentCount}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-4">
          <p className="text-xs text-muted-foreground">Failed</p>
          <p className="mt-1 text-2xl font-bold text-red-600">{failedCount}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-4">
          <p className="text-xs text-muted-foreground">Pending</p>
          <p className="mt-1 text-2xl font-bold text-amber-600">{pendingCount}</p>
        </CardContent></Card>
      </div>

      {/* Log table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BellRing className="h-4 w-4" />
            Delivery Log
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : logs.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No notification delivery records found.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Sent At</TableHead>
                    <TableHead>Provider</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map(log => (
                    <TableRow key={log.id}>
                      <TableCell className="text-sm font-medium">
                        {log.recipient_name ?? log.recipient_address ?? '—'}
                        {log.recipient_address && log.recipient_name && (
                          <p className="text-xs text-muted-foreground">{log.recipient_address}</p>
                        )}
                      </TableCell>
                      <TableCell><ChannelBadge channel={log.channel} /></TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-muted-foreground" title={log.subject ?? undefined}>
                        {log.subject ?? '—'}
                      </TableCell>
                      <TableCell><StatusBadge status={log.status} /></TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDatetime(log.sent_at ?? log.created_at)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{log.provider ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

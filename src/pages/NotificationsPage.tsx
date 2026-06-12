import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { fetchNotifications } from '@/services/mockNotificationService';
import type { Notification, NotificationType, NotificationStatus } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Bell, Search, CheckCircle2, XCircle, Clock, MessageCircle, Mail, Phone } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';

function TypeIcon({ type }: { type: NotificationType }) {
  if (type === 'whatsapp') return <MessageCircle className="w-3.5 h-3.5 text-green-600" />;
  if (type === 'sms') return <Phone className="w-3.5 h-3.5 text-blue-600" />;
  return <Mail className="w-3.5 h-3.5 text-purple-600" />;
}

function StatusBadge({ status }: { status: NotificationStatus }) {
  if (status === 'sent') return <Badge variant="success" className="text-xs gap-1"><CheckCircle2 className="w-3 h-3" />Sent</Badge>;
  if (status === 'failed') return <Badge variant="destructive" className="text-xs gap-1"><XCircle className="w-3 h-3" />Failed</Badge>;
  return <Badge variant="warning" className="text-xs gap-1"><Clock className="w-3 h-3" />Pending</Badge>;
}

export default function NotificationsPage() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<NotificationType | ''>('');
  const [filterStatus, setFilterStatus] = useState<NotificationStatus | ''>('');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try { setNotifications(await fetchNotifications(user.organization.id)); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const filtered = notifications.filter(n => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      n.case?.case_number.toLowerCase().includes(q) ||
      n.case?.client_name.toLowerCase().includes(q) ||
      n.recipient.toLowerCase().includes(q);
    const matchType = !filterType || n.notification_type === filterType;
    const matchStatus = !filterStatus || n.status === filterStatus;
    return matchSearch && matchType && matchStatus;
  });

  const counts = {
    sent: notifications.filter(n => n.status === 'sent').length,
    failed: notifications.filter(n => n.status === 'failed').length,
    pending: notifications.filter(n => n.status === 'pending').length,
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 sm:gap-4">
        <Card className="bg-green-50 border-green-200 cursor-pointer hover:bg-green-100 transition-colors" onClick={() => setFilterStatus('sent')}>
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
            <div>
              <p className="text-2xl font-bold text-green-700">{counts.sent}</p>
              <p className="text-xs text-green-600">Sent</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-red-50 border-red-200 cursor-pointer hover:bg-red-100 transition-colors" onClick={() => setFilterStatus('failed')}>
          <CardContent className="p-4 flex items-center gap-3">
            <XCircle className="w-8 h-8 text-red-600" />
            <div>
              <p className="text-2xl font-bold text-red-700">{counts.failed}</p>
              <p className="text-xs text-red-600">Failed</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 border-amber-200 cursor-pointer hover:bg-amber-100 transition-colors" onClick={() => setFilterStatus('pending')}>
          <CardContent className="p-4 flex items-center gap-3">
            <Clock className="w-8 h-8 text-amber-600" />
            <div>
              <p className="text-2xl font-bold text-amber-700">{counts.pending}</p>
              <p className="text-xs text-amber-600">Pending</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by case, client, recipient…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterType || 'all'} onValueChange={v => setFilterType(v === 'all' ? '' : v as NotificationType)}>
          <SelectTrigger className="h-10 w-full text-xs sm:w-36"><SelectValue placeholder="All Types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="whatsapp">WhatsApp</SelectItem>
            <SelectItem value="sms">SMS</SelectItem>
            <SelectItem value="email">Email</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus || 'all'} onValueChange={v => setFilterStatus(v === 'all' ? '' : v as NotificationStatus)}>
          <SelectTrigger className="h-10 w-full text-xs sm:w-36"><SelectValue placeholder="All Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
        {(filterType || filterStatus || search) && (
          <Button variant="ghost" size="sm" className="h-10 text-xs text-muted-foreground"
            onClick={() => { setFilterType(''); setFilterStatus(''); setSearch(''); }}>
            Clear
          </Button>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="w-4 h-4 text-blue-600" />
            Notification Logs
            <Badge variant="outline" className="ml-1">{filtered.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Bell className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm font-medium">No notifications yet</p>
              <p className="text-xs mt-1">Click <strong>Run Daily Sync</strong> to generate notification logs.</p>
            </div>
          ) : (
            <Table className="min-w-[980px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Case Number</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent Time</TableHead>
                  <TableHead>Response</TableHead>
                  <TableHead>Retries</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(n => (
                  <TableRow key={n.id}>
                    <TableCell className="font-mono text-xs font-semibold">{n.case?.case_number}</TableCell>
                    <TableCell className="text-xs">{n.case?.client_name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 capitalize text-xs">
                        <TypeIcon type={n.notification_type} />
                        {n.notification_type}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs max-w-[160px] truncate font-mono">{n.recipient}</TableCell>
                    <TableCell><StatusBadge status={n.status} /></TableCell>
                    <TableCell className="text-xs">{n.sent_time ? formatDateTime(n.sent_time) : '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{n.response ?? '—'}</TableCell>
                    <TableCell className="text-center text-xs">{n.retry_count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

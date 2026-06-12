import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { fetchMatches } from '@/services/mockCauseListService';
import type { CauseListMatch } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, GitCompare } from 'lucide-react';

function MatchTypeBadge({ type }: { type: CauseListMatch['match_type'] }) {
  if (type === 'cnr') return <Badge variant="info" className="text-xs">CNR Match</Badge>;
  if (type === 'case_number') return <Badge variant="success" className="text-xs">Case No Match</Badge>;
  return <Badge variant="warning" className="text-xs">Fuzzy Match</Badge>;
}

export default function MatchedCasesPage() {
  const { user } = useAuth();
  const [matches, setMatches] = useState<CauseListMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try { setMatches(await fetchMatches(user.organization.id)); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const filtered = matches.filter(m => {
    const q = search.toLowerCase();
    return !q ||
      m.case?.case_number.toLowerCase().includes(q) ||
      m.case?.cnr_number.toLowerCase().includes(q) ||
      m.case?.client_name.toLowerCase().includes(q) ||
      m.case?.advocate_name.toLowerCase().includes(q) ||
      m.cause_list?.court_name.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="relative w-full sm:max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search matched cases…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-emerald-600" />
            Matched Cases
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
              <GitCompare className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm font-medium">No matched cases yet</p>
              <p className="text-xs mt-1">Click <strong>Run Daily Sync</strong> in the header to generate matches.</p>
            </div>
          ) : (
            <Table className="min-w-[1200px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Case Number</TableHead>
                  <TableHead>CNR</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Advocate</TableHead>
                  <TableHead>Court</TableHead>
                  <TableHead>Bench</TableHead>
                  <TableHead>Judge</TableHead>
                  <TableHead>Court Hall</TableHead>
                  <TableHead>Listing No</TableHead>
                  <TableHead>Match Type</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Alert</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(m => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-xs font-semibold">{m.case?.case_number}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{m.case?.cnr_number || '—'}</TableCell>
                    <TableCell className="text-xs">{m.case?.client_name}</TableCell>
                    <TableCell className="text-xs">{m.case?.advocate_name}</TableCell>
                    <TableCell className="text-xs">{m.cause_list?.court_name}</TableCell>
                    <TableCell className="text-xs">{m.cause_list?.bench}</TableCell>
                    <TableCell className="text-xs max-w-[160px] truncate">{m.cause_list?.judge_name}</TableCell>
                    <TableCell className="text-xs font-medium">{m.cause_list?.court_no}</TableCell>
                    <TableCell className="text-center font-semibold">{m.cause_list?.listing_no}</TableCell>
                    <TableCell><MatchTypeBadge type={m.match_type} /></TableCell>
                    <TableCell>
                      <span className={`text-xs font-bold ${m.match_confidence >= 95 ? 'text-green-700' : m.match_confidence >= 80 ? 'text-amber-700' : 'text-red-700'}`}>
                        {m.match_confidence}%
                      </span>
                    </TableCell>
                    <TableCell>
                      {m.alert_required
                        ? <Badge variant="success" className="text-xs">Required</Badge>
                        : <Badge variant="secondary" className="text-xs">None</Badge>}
                    </TableCell>
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

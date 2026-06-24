import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { RELATIONSHIP_TYPES, searchCases, type CaseSearchResult } from '@/lib/connections';

const PAGE_SIZE = 8;

/**
 * Full-size "Search Connected Case" modal. Pick a relationship type, search the
 * `cases` table across Case Number / Petitioner / Respondent / CNR, then select
 * a case from a paginated, scrollable results grid. Stays open for multiple adds.
 * The host decides what `onAdd` does (insert a connection, or push to a draft).
 */
export function AddConnectionDialog({
  open, onOpenChange, excludeIds, orgId, onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  excludeIds: string[];
  orgId?: string | null;
  onAdd: (caseRow: CaseSearchResult, relationshipType: string) => void | Promise<void>;
}) {
  const [relationship, setRelationship] = useState<string>('Connected');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CaseSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // `excludeIds` is a fresh array on every parent render, so depend on its
  // contents (a stable string) instead of its reference — otherwise the search
  // effect re-runs on every re-render and the spinner never resolves.
  const excludeKey = useMemo(() => excludeIds.join('|'), [excludeIds]);

  useEffect(() => {
    if (!open) { setQuery(''); setResults([]); setRelationship('Connected'); setPage(1); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const rows = await searchCases(query, excludeIds, 50, orgId);
        if (!cancelled) { setResults(rows); setPage(1); }
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : 'Search failed.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, open, excludeKey, orgId]);

  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const pageRows = useMemo(
    () => results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [results, page],
  );

  async function select(row: CaseSearchResult) {
    setBusyId(row.id);
    try {
      await onAdd(row, relationship);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[95vw] flex-col overflow-hidden sm:max-w-[900px]">
        <DialogHeader>
          <DialogTitle>Search Connected Case</DialogTitle>
          <DialogDescription>Search by Case Number, Petitioner, Respondent or CNR Number, then select a case to link.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[220px_1fr]">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Relationship</Label>
            <Select value={relationship} onValueChange={setRelationship}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RELATIONSHIP_TYPES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Search</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Case Number, Petitioner, Respondent or CNR Number…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                autoFocus
              />
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </div>
          ) : results.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">No matching cases.</p>
          ) : (
            <Table className="min-w-[820px]">
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead>Case Number</TableHead>
                  <TableHead>Petitioner</TableHead>
                  <TableHead>Respondent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs font-semibold">{r.case_number || '—'}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-xs" title={r.petitioner ?? ''}>{r.petitioner || '—'}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-xs" title={r.respondent ?? ''}>{r.respondent || '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{r.case_status || '—'}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" className="h-7 gap-1 text-xs"
                        disabled={busyId === r.id} onClick={() => select(r)}>
                        {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        Select
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {results.length > 0 && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{results.length} result{results.length !== 1 ? 's' : ''}</span>
            <div className="flex items-center gap-2">
              <Button size="icon" variant="outline" className="h-7 w-7"
                disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[80px] text-center">Page {page} of {totalPages}</span>
              <Button size="icon" variant="outline" className="h-7 w-7"
                disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

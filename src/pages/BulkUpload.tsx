import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload, Download, FileSpreadsheet, AlertTriangle, CheckCircle2, RefreshCw, Shield, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import { useOrg } from '@/lib/orgContext';
import {
  downloadErrorReport,
  downloadTemplate,
  fetchImportHistory,
  parseWorkbook,
  runBulkImport,
  type BulkPreview,
  type ExistingMode,
} from '@/lib/bulkUpload';

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function TotalsCard({ title, value, icon: Icon }: { title: string; value: number; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between px-4 py-4">
        <div>
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="mt-1 text-2xl font-bold">{value.toLocaleString('en-IN')}</p>
        </div>
        <Icon className="h-5 w-5 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

export default function BulkUploadPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { org } = useOrg();
  const orgId = org?.id ?? null;
  const uploadedBy = user?.profile?.full_name || user?.email || 'Unknown';

  const [mode, setMode] = useState<ExistingMode>('update');
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof runBulkImport>> | null>(null);

  const historyQ = useQuery({
    enabled: !!orgId,
    queryKey: ['bulk-upload-history', orgId],
    queryFn: () => fetchImportHistory(orgId as string),
  });

  const issueCounts = useMemo(() => {
    const issues = preview?.issues ?? [];
    return {
      errors: issues.filter(i => i.severity === 'error').length,
      warnings: issues.filter(i => i.severity === 'warning').length,
    };
  }, [preview]);

  async function onFileChange(file: File | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      toast.error('Please upload a .xlsx file.');
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const next = await parseWorkbook(file);
      setPreview(next);
      setFileName(file.name);
      toast.success('Workbook parsed. Review preview before importing.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to parse workbook.';
      toast.error(msg);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function startImport() {
    if (!orgId) {
      toast.error('No organization resolved for the current user.');
      return;
    }
    if (!preview) {
      toast.error('Upload and validate a workbook first.');
      return;
    }

    setBusy(true);
    try {
      const importResult = await runBulkImport({
        orgId,
        uploadedBy,
        mode,
        preview,
      });
      setResult(importResult);
      await qc.invalidateQueries({ queryKey: ['bulk-upload-history', orgId] });
      if (importResult.errors.length > 0) {
        toast.warning('Import completed with errors. Download the error report for details.');
      } else {
        toast.success('Bulk import completed successfully.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk import failed.');
    } finally {
      setBusy(false);
    }
  }

  const previewRows = useMemo(() => {
    if (!preview) return [] as Array<Record<string, unknown>>;
    const firstSheet = preview.data.cases.length > 0
      ? preview.data.cases.slice(0, 8)
      : preview.data.tasks.length > 0
        ? preview.data.tasks.slice(0, 8)
        : preview.data.advocates.length > 0
          ? preview.data.advocates.slice(0, 8)
          : preview.data.recipients.slice(0, 8);
    return firstSheet as Array<Record<string, unknown>>;
  }, [preview]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Bulk Upload</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Import cases, connected cases, tasks, advocates and notification recipients from a multi-sheet Excel workbook.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2" onClick={() => downloadTemplate()}>
            <Download className="h-4 w-4" /> Download Sample Template
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => historyQ.refetch()}>
            <RefreshCw className="h-4 w-4" /> Refresh History
          </Button>
        </div>
      </div>

      {!orgId && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No organization resolved for the current user. Bulk upload is blocked until organization context is available.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <TotalsCard title="Cases" value={preview?.counts.cases ?? 0} icon={FileSpreadsheet} />
        <TotalsCard title="Connected Cases" value={preview?.counts.connectedCases ?? 0} icon={Shield} />
        <TotalsCard title="Tasks" value={preview?.counts.tasks ?? 0} icon={CheckCircle2} />
        <TotalsCard title="Issues" value={(issueCounts.errors + issueCounts.warnings) ?? 0} icon={AlertTriangle} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Upload className="h-4 w-4" /> Upload Workbook</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1fr_220px]">
              <div className="space-y-1.5">
                <Label htmlFor="bulk-file">Excel File (.xlsx)</Label>
                <Input id="bulk-file" type="file" accept=".xlsx" disabled={busy || !orgId} onChange={e => void onFileChange(e.target.files?.[0] ?? null)} />
                {fileName && <p className="text-xs text-muted-foreground">Loaded: {fileName}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Existing Records</Label>
                <Select value={mode} onValueChange={v => setMode(v as ExistingMode)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="update">Update Existing</SelectItem>
                    <SelectItem value="skip">Skip Existing</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-full bg-muted px-2.5 py-1">Mandatory: Case Number</span>
              <span className="rounded-full bg-muted px-2.5 py-1">Duplicate CNR blocked</span>
              <span className="rounded-full bg-muted px-2.5 py-1">Cross-org access prevented</span>
              <span className="rounded-full bg-muted px-2.5 py-1">Connected cases must exist</span>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void startImport()} disabled={busy || !preview || issueCounts.errors > 0 || !orgId}>
                {busy ? 'Processing…' : 'Import Workbook'}
              </Button>
              <Button variant="outline" disabled={!preview} onClick={() => preview && downloadErrorReport(preview)}>
                Download Error Report
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4" /> Import Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatBadge label="Errors" value={issueCounts.errors} variant={issueCounts.errors > 0 ? 'destructive' : 'secondary'} />
              <StatBadge label="Warnings" value={issueCounts.warnings} variant={issueCounts.warnings > 0 ? 'warning' : 'secondary'} />
              <StatBadge label="Mode" value={mode === 'update' ? 'Update' : 'Skip'} variant="info" />
              <StatBadge label="Org" value={org?.short_name ?? org?.organization_name ?? '\u2014'} variant="outline" />
            </div>

            {result && (
              <div className="rounded-md border bg-muted/20 p-3 text-xs">
                <p className="font-semibold text-foreground">Last import result</p>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div>Inserted: {Object.values(result.inserted).reduce((a, b) => a + b, 0)}</div>
                  <div>Updated: {Object.values(result.updated).reduce((a, b) => a + b, 0)}</div>
                  <div>Skipped: {Object.values(result.skipped).reduce((a, b) => a + b, 0)}</div>
                </div>
              </div>
            )}

            {!preview && (
              <p className="text-muted-foreground">Upload a workbook to see validation results and row preview.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="preview">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="issues">Errors & Warnings</TabsTrigger>
          <TabsTrigger value="history">Import History</TabsTrigger>
        </TabsList>

        <TabsContent value="preview">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Preview</CardTitle>
            </CardHeader>
            <CardContent>
              {!preview ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No workbook uploaded yet.</p>
              ) : previewRows.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Workbook contains no importable rows.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {Object.keys(previewRows[0]).map(key => <TableHead key={key}>{key}</TableHead>)}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewRows.map((row, idx) => (
                        <TableRow key={idx}>
                          {Object.entries(row).map(([key, value]) => <TableCell key={key} className="text-xs">{String(value ?? '\u2014')}</TableCell>)}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="issues">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Validation Issues</CardTitle>
            </CardHeader>
            <CardContent>
              {!preview || preview.issues.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No issues detected.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sheet</TableHead>
                        <TableHead>Row</TableHead>
                        <TableHead>Field</TableHead>
                        <TableHead>Severity</TableHead>
                        <TableHead>Message</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.issues.map((issue, idx) => (
                        <TableRow key={`${issue.sheet}-${issue.row}-${issue.field}-${idx}`}>
                          <TableCell>{issue.sheet}</TableCell>
                          <TableCell>{issue.row || '\u2014'}</TableCell>
                          <TableCell>{issue.field}</TableCell>
                          <TableCell>
                            <Badge variant={issue.severity === 'error' ? 'destructive' : 'warning'}>{issue.severity}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">{issue.message}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Import History</CardTitle>
            </CardHeader>
            <CardContent>
              {historyQ.isLoading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Loading history…</p>
              ) : historyQ.error ? (
                <p className="py-8 text-center text-sm text-destructive">{(historyQ.error as Error).message}</p>
              ) : !historyQ.data || historyQ.data.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No import history yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>File</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Mode</TableHead>
                        <TableHead>Issues</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historyQ.data.map((row, idx) => {
                        const file = String(row.file_name ?? '\u2014');
                        const status = String(row.status ?? '\u2014');
                        const issueCount = Number(row.issue_count ?? row.error_count ?? 0);
                        return (
                          <TableRow key={`${file}-${idx}`}>
                            <TableCell className="max-w-[240px] truncate text-xs" title={file}>{file}</TableCell>
                            <TableCell><Badge variant={status.includes('fail') ? 'destructive' : status.includes('error') ? 'warning' : 'success'}>{status}</Badge></TableCell>
                            <TableCell className="text-xs">{String(row.import_mode ?? '\u2014')}</TableCell>
                            <TableCell className="text-xs">{issueCount}</TableCell>
                            <TableCell className="text-xs">{fmtDateTime(String(row.created_at ?? ''))}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatBadge({ label, value, variant }: { label: string; value: string | number; variant: 'secondary' | 'destructive' | 'warning' | 'info' | 'outline' }) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2 text-center">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <Badge variant={variant} className="mt-1">{value}</Badge>
    </div>
  );
}

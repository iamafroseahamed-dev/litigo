import { useState, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { processBulkUpload } from '@/services/mockCaseService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Upload, Download, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle, Copy } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { BulkUploadResult } from '@/types';

const TEMPLATE_COLUMNS = [
  'cnr_number', 'case_number', 'court_name', 'bench', 'petitioner', 'respondent',
  'advocate_name', 'advocate_mobile', 'advocate_email',
  'client_name', 'client_mobile', 'client_whatsapp', 'client_email', 'active',
];

const TEMPLATE_SAMPLE = [
  'TNHC0010002024', 'WP/1234/2024', 'Madras High Court', 'Chennai',
  'ABC Industries', 'State of Tamil Nadu', 'S. Ramaswamy',
  '9444100001', 'ramaswamy@legalmail.in',
  'ABC Industries', '9500200001', '9500200001', 'arun@example.com', 'TRUE',
];

function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_COLUMNS, TEMPLATE_SAMPLE]);

  // Style header row
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c });
    if (!ws[cellRef]) continue;
    ws[cellRef].s = { font: { bold: true }, fill: { fgColor: { rgb: 'DBEAFE' } } };
  }
  ws['!cols'] = TEMPLATE_COLUMNS.map(() => ({ wch: 22 }));

  XLSX.utils.book_append_sheet(wb, ws, 'Cases');
  XLSX.writeFile(wb, 'legal_case_alert_template.xlsx');
}

function exportErrors(result: BulkUploadResult) {
  const rows = result.rows.filter(r => r.status !== 'success').map(r => ({
    Row: r.rowNumber,
    Status: r.status,
    CaseNumber: (r.data as Record<string, string>).case_number ?? '',
    Errors: r.errors.join('; '),
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Errors');
  XLSX.writeFile(wb, 'upload_errors.xlsx');
}

export default function BulkUploadPage() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<BulkUploadResult | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const processFile = async (file: File) => {
    if (!user) return;
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      toast.error('Please upload an Excel file (.xlsx or .xls)');
      return;
    }

    setUploading(true);
    setResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });

      if (rawRows.length === 0) {
        toast.error('The spreadsheet is empty or has no data rows.');
        return;
      }

      const uploadResult = await processBulkUpload(user.organization.id, rawRows);
      setResult(uploadResult);

      if (uploadResult.success > 0) {
        toast.success(`Upload complete! ${uploadResult.success} cases imported successfully.`);
      } else {
        toast.error('No cases were imported. Check the error report below.');
      }
    } catch (err) {
      toast.error('Failed to process file: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  return (
    <div className="max-w-4xl space-y-4 sm:space-y-6">
      {/* Instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            Excel Bulk Upload
          </CardTitle>
          <CardDescription>
            Upload multiple cases at once using an Excel spreadsheet. Download the template to get started.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
            <Button variant="outline" onClick={downloadTemplate} className="h-10 gap-2">
              <Download className="w-4 h-4" /> Download Template
            </Button>
            <span className="text-xs text-muted-foreground">Excel template with required column headers</span>
          </div>
          {/* Column Reference */}
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Required Columns</p>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_COLUMNS.map(col => (
                <code key={col} className="text-xs bg-background border rounded px-1.5 py-0.5">{col}</code>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              <strong>case_number</strong> is required. CNR format: e.g. TNHC0010002024. Mobile: 10 digits starting with 6-9.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Upload Zone */}
      <Card
        className={`border-2 border-dashed transition-colors cursor-pointer ${dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/20 hover:border-primary/50'}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <CardContent className="flex flex-col items-center justify-center py-12">
          {uploading ? (
            <>
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-sm font-medium">Processing file…</p>
              <p className="text-xs text-muted-foreground mt-1">Validating rows and importing cases</p>
            </>
          ) : (
            <>
              <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                <Upload className="w-7 h-7 text-primary" />
              </div>
              <p className="px-2 text-center text-sm font-medium">Drop your Excel file here or click to browse</p>
              <p className="mt-1 text-center text-xs text-muted-foreground">Supports .xlsx and .xls files</p>
            </>
          )}
        </CardContent>
      </Card>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-blue-700">{result.total}</p>
                <p className="text-xs text-blue-600 mt-0.5">Total Records</p>
              </CardContent>
            </Card>
            <Card className="bg-green-50 border-green-200">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-green-700">{result.success}</p>
                <p className="text-xs text-green-600 mt-0.5">Imported</p>
              </CardContent>
            </Card>
            <Card className="bg-amber-50 border-amber-200">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-amber-700">{result.duplicates}</p>
                <p className="text-xs text-amber-600 mt-0.5">Duplicates</p>
              </CardContent>
            </Card>
            <Card className="bg-red-50 border-red-200">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-red-700">{result.failed}</p>
                <p className="text-xs text-red-600 mt-0.5">Failed</p>
              </CardContent>
            </Card>
          </div>

          {/* Error Details */}
          {result.rows.some(r => r.status !== 'success') && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
                  <CardTitle className="text-sm text-red-700">
                    Issues ({result.rows.filter(r => r.status !== 'success').length} rows)
                  </CardTitle>
                  <Button variant="outline" size="sm" onClick={() => exportErrors(result)} className="h-10 gap-2 text-xs">
                    <Download className="w-3.5 h-3.5" /> Export Errors
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table className="min-w-[560px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Row</TableHead>
                      <TableHead>Case Number</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.rows.filter(r => r.status !== 'success').map(r => (
                      <TableRow key={r.rowNumber}>
                        <TableCell className="font-mono text-xs">{r.rowNumber}</TableCell>
                        <TableCell className="font-mono text-xs">{(r.data as Record<string, string>).case_number || '—'}</TableCell>
                        <TableCell>
                          {r.status === 'duplicate'
                            ? <Badge variant="warning" className="text-xs gap-1"><Copy className="w-3 h-3" />Duplicate</Badge>
                            : <Badge variant="destructive" className="text-xs gap-1"><XCircle className="w-3 h-3" />Error</Badge>}
                        </TableCell>
                        <TableCell className="text-xs text-red-600">{r.errors.join('; ')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {result.success > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              <CheckCircle2 className="w-4 h-4" />
              {result.success} case(s) successfully imported and are now available in the Cases module.
            </div>
          )}
          {result.duplicates > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              <AlertTriangle className="w-4 h-4" />
              {result.duplicates} duplicate case(s) were skipped to prevent double entry.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

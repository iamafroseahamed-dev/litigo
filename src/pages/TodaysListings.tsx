import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, X, Eye, ChevronLeft, ChevronRight, ExternalLink, RefreshCw, Bell, Send, FileText, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { Case, CaseNotificationRecipient, CauseListNotifStatus, NotificationLog } from '@/types';

// ── MHC order row returned by /api/mhc/case-status ───────────────────────────
interface MhcOrderRow {
  casetype_t: string;
  caseno: string;
  petname: string;
  resname: string;
  juddate: string;
  jud1: string;
  filename: string;
  citno: string;
  pdf_url: string | null;
}
interface MhcStatusResult {
  success: boolean;
  case_number: string;
  main_cnt: string | null;
  orders: MhcOrderRow[];
}

interface DailyCauseListRecord {
  id?: string;
  cause_date: string;
  court_name: string | null;
  bench: string | null;
  court_hall: string | null;
  item_number: string | null;
  case_number: string | null;
  cnr_number: string | null;
  petitioner: string | null;
  respondent: string | null;
  party_names: string | null;
  judge_name: string | null;
  last_hearing_or_stage: string | null;
  counsel_name: string | null;
}

type MatchType = 'cnr' | 'case_number';

interface MatchedRecord {
  causeList: DailyCauseListRecord;
  case: Case;
  matchType: MatchType;
  matchedBy: string;
}

interface CaseDetailsLink {
  text: string;
  href: string;
}

interface CaseDetailsTable {
  title: string;
  headers: string[];
  rows: string[][];
  columnCount: number;
}

interface CaseDetailsResponse {
  success: boolean;
  requiresCaptcha?: boolean;
  error?: string;
  message?: string;
  caseNumber?: string;
  captchaToken?: string;
  captchaImage?: string;
  searchType?: 'CNR' | 'CASE_NUMBER';
  cnr_number?: string;
  case_number?: string;
  parsedCaseType?: string;
  parsedCaseNo?: string;
  parsedYear?: string;
  text?: string;
  tables?: CaseDetailsTable[];
  links?: CaseDetailsLink[];
  raw_html?: string;
  summary_fields?: Record<string, string>;
}

type SortField = 'court_hall' | 'item_number' | 'case_number' | 'next_hearing_date';
type SortDir = 'asc' | 'desc';
type SectionKey =
  | 'case-summary'
  | 'case-status'
  | 'parties'
  | 'advocates'
  | 'acts'
  | 'hearing-history'
  | 'orders'
  | 'documents'
  | 'scrutiny'
  | 'case-timeline';

const PAGE_SIZE = 20;

const SECTION_CONFIG: Array<{ key: SectionKey; title: string; keywords: string[] }> = [
  {
    key: 'case-summary',
    title: 'Case Summary',
    // Backend titles: 'Case Details', 'Case Status', 'Category Details', 'Sub Matters', 'Linked Cases'
    keywords: ['case details', 'case summary', 'registration', 'filing', 'cnr', 'category details', 'sub matters', 'linked cases'],
  },
  {
    key: 'case-status',
    title: 'Case Status',
    keywords: ['case status', 'status', 'disposal', 'disposed', 'first hearing', 'decision date', 'nature of disposal'],
  },
  {
    key: 'parties',
    title: 'Parties',
    // Backend title: 'Parties' (role, name, advocate 3-col table)
    keywords: ['parties', 'petitioner', 'respondent', 'appellant', 'defendant', 'complainant'],
  },
  {
    key: 'advocates',
    title: 'Advocates',
    keywords: ['advocate', 'counsel', 'lawyer'],
  },
  {
    key: 'acts',
    title: 'Acts / Applicable Laws',
    keywords: ['acts', 'act', 'under act', 'section', 'applicable law'],
  },
  {
    key: 'hearing-history',
    title: 'Hearing History',
    // Backend title: 'History of Case Hearing'
    keywords: ['history of case hearing', 'hearing history', 'hearing date', 'business on date', 'cause list type'],
  },
  {
    key: 'orders',
    title: 'Orders',
    keywords: ['orders', 'order no', 'order date', 'pdf link', 'order details', 'order number'],
  },
  {
    key: 'documents',
    title: 'Documents',
    // Backend title: 'Document Details'
    keywords: ['document details', 'document filed', 'date of receiving', 'filed by'],
  },
  {
    key: 'scrutiny',
    title: 'Scrutiny / Objections',
    // Backend title: 'Scrutiny / Objections'
    keywords: ['scrutiny', 'objection', 'compliance date', 'receipt date', 'objection compliance'],
  },
  {
    key: 'case-timeline',
    title: 'Case Timeline',
    keywords: [],
  },
];

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function normalizeText(value: string | null | undefined) {
  return (value ?? '').trim();
}

function MatchTypeBadge({ type, matchedBy }: { type: MatchType; matchedBy: string }) {
  const label = type === 'cnr' ? 'CNR Match' : 'Case Number Match';
  const variant = type === 'cnr' ? 'success' : 'info';
  return (
    <span title={`Matched by: ${matchedBy}`}>
      <Badge variant={variant}>{label}</Badge>
    </span>
  );
}

function SummaryCard({ title, value }: { title: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="pb-4 pt-4">
        <p className="text-xs text-muted-foreground">{title}</p>
        <p className="mt-1 text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function DetailsGrid({ rows }: { rows: string[][] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {rows.map((row, index) => (
        <div key={`${row[0] ?? 'row'}-${index}`} className="rounded-md border bg-muted/20 p-3">
          <p className="text-xs text-muted-foreground">{row[0] || `Field ${index + 1}`}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm font-medium">{row.slice(1).join(' ') || '—'}</p>
        </div>
      ))}
    </div>
  );
}

function DynamicTable({ table }: { table: CaseDetailsTable }) {
  const maxColumns = Math.max(table.columnCount, table.headers.length, ...table.rows.map((row) => row.length), 0);
  const isTwoColumnRows = maxColumns <= 2 && table.rows.length > 0;
  const headers = table.headers.length > 0
    ? table.headers
    : Array.from({ length: maxColumns }, (_, index) => `Column ${index + 1}`);

  // Detect which column index holds PDF links
  const pdfColIdx = headers.findIndex((h) =>
    ['pdf link', 'pdf', 'order details', 'view'].some((kw) => h.toLowerCase().includes(kw)),
  );

  /** Extract the bare filename from an MHC PDF URL, e.g.
   *  https://mhc.tn.gov.in/judis/index.php/casestatus/viewpdf/ABC123
   *  → "ABC123"
   */
  const extractFilename = (url: string): string => {
    const m = url.match(/viewpdf\/([^/?#]+)/i);
    if (m) return m[1];
    // fallback: last path segment before any query
    return url.split('?')[0].split('/').pop() ?? url;
  };

  const openPdf = (originalUrl: string) => {
    const filename = extractFilename(originalUrl);    
    const viewerUrl = `https://mhc.tn.gov.in/judis/index.php/casestatus/viewpdf/${encodeURIComponent(filename)}`;
    window.open(viewerUrl, '_blank', 'noopener,noreferrer');
  };

  const renderCell = (value: string, colIdx: number) => {
    if (colIdx === pdfColIdx && value && value.startsWith('http')) {
      return (
        <button
          type="button"
          onClick={() => openPdf(value)}
          className="inline-flex items-center gap-1 text-blue-700 hover:underline text-xs cursor-pointer"
        >
          <ExternalLink className="h-3 w-3" /> View PDF
        </button>
      );
    }
    return value || '—';
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{table.title || 'Extracted Table'}</CardTitle>
      </CardHeader>
      <CardContent>
        {isTwoColumnRows ? (
          <DetailsGrid rows={table.rows} />
        ) : (
          <ScrollArea className="w-full whitespace-nowrap rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {headers.map((header, index) => (
                    <TableHead key={`${header}-${index}`}>{header || `Column ${index + 1}`}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={headers.length || 1} className="text-muted-foreground">
                      No rows found.
                    </TableCell>
                  </TableRow>
                ) : (
                  table.rows.map((row, rowIndex) => (
                    <TableRow key={`${table.title}-${rowIndex}`}>
                      {headers.map((_, colIndex) => (
                        <TableCell key={`${table.title}-${rowIndex}-${colIndex}`} className="align-top whitespace-pre-wrap">
                          {renderCell(row[colIndex] ?? '', colIndex)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

const ECOURTS_LOADING_MESSAGES = [
  'Connecting to eCourts server…',
  'Waiting for response from hcservices.ecourts.gov.in…',
  'Fetching case history and hearing records…',
  'eCourts can be slow — please hang on…',
  'Almost there…',
];

function LoadingDetails({ elapsedSeconds }: { elapsedSeconds: number }) {
  const msgIndex = Math.min(
    Math.floor(elapsedSeconds / 9),
    ECOURTS_LOADING_MESSAGES.length - 1,
  );

  return (
    <div className="flex flex-col items-center gap-6 py-10">
      {/* Spinner */}
      <div className="h-11 w-11 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />

      {/* Status text */}
      <div className="text-center space-y-1.5">
        <p className="text-sm font-medium">{ECOURTS_LOADING_MESSAGES[msgIndex]}</p>
        <p className="text-xs text-muted-foreground">
          {elapsedSeconds > 0 ? `${elapsedSeconds}s elapsed` : 'Starting…'}
          {elapsedSeconds >= 15 && ' · eCourts typically takes 15–45 s'}
        </p>
      </div>

      {/* Skeleton placeholders so the dialog doesn't feel empty */}
      <div className="w-full space-y-3 pt-2">
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
        <Skeleton className="h-10" />
        <Skeleton className="h-40" />
        <Skeleton className="h-28" />
      </div>
    </div>
  );
}

function getTableSearchText(table: CaseDetailsTable) {
  return [table.title, ...table.headers, ...table.rows.flat()].join(' ').toLowerCase();
}

function groupTablesBySection(tables: CaseDetailsTable[]) {
  const grouped = new Map<SectionKey, CaseDetailsTable[]>();
  const unmatched: CaseDetailsTable[] = [];

  for (const config of SECTION_CONFIG) {
    grouped.set(config.key, []);
  }

  for (const table of tables) {
    const haystack = getTableSearchText(table);
    const matchedSection = SECTION_CONFIG.find(
      (config) =>
        config.key !== 'case-timeline' &&
        config.keywords.length > 0 &&
        config.keywords.some((keyword) => haystack.includes(keyword)),
    );

    if (matchedSection) {
      grouped.get(matchedSection.key)?.push(table);
    } else {
      unmatched.push(table);
    }
  }

  return { grouped, unmatched };
}

function getLinksForSection(section: SectionKey, links: CaseDetailsLink[]) {
  if (section === 'case-timeline') return [];

  const keywordMap: Record<Exclude<SectionKey, 'case-timeline'>, string[]> = {
    'case-summary': ['summary', 'case'],
    'case-status': ['status', 'stage'],
    parties: ['party', 'petitioner', 'respondent'],
    advocates: ['advocate', 'counsel'],
    acts: ['act', 'law', 'section'],
    'hearing-history': ['history', 'hearing', 'proceeding'],
    orders: ['order', 'judgment'],
    documents: ['document', 'pdf', 'download'],
    scrutiny: ['scrutiny', 'objection', 'defect'],
  };

  const keywords = keywordMap[section as Exclude<SectionKey, 'case-timeline'>] ?? [];
  if (!keywords.length) return [];

  return links.filter((link) => {
    const haystack = `${link.text} ${link.href}`.toLowerCase();
    return keywords.some((keyword) => haystack.includes(keyword));
  });
}

// ─── Field extractor ─────────────────────────────────────────────────────────

function extractField(
  tables: CaseDetailsTable[],
  summaryFields: Record<string, string>,
  ...searchKeys: string[]
): string {
  for (const [key, value] of Object.entries(summaryFields)) {
    for (const sk of searchKeys) {
      if (key.toLowerCase().includes(sk.toLowerCase())) return value;
    }
  }
  for (const table of tables) {
    for (const row of table.rows) {
      if (row.length === 2) {
        for (const sk of searchKeys) {
          if (row[0].toLowerCase().includes(sk.toLowerCase())) return row[1];
        }
      }
    }
  }
  return '';
}

// ─── Case Timeline ─────────────────────────────────────────────────────────────

type TimelineEventType = 'filing' | 'registration' | 'hearing' | 'order' | 'disposal' | 'other';
interface TimelineEvent { date: string; label: string; type: TimelineEventType }

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function normDateStr(raw: string): string {
  const m = raw.match(/^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})$/);
  if (!m) return raw;
  const mo = (MONTH_ABBR.indexOf(m[2]) + 1).toString().padStart(2, '0');
  return `${m[3]}-${mo}-${m[1].padStart(2, '0')}`;
}

function TimelineSection({
  tables,
  summaryFields,
}: {
  tables: CaseDetailsTable[];
  summaryFields: Record<string, string>;
}) {
  const events: TimelineEvent[] = useMemo(() => {
    const list: TimelineEvent[] = [];
    const filingDate = extractField(tables, summaryFields, 'Filing Date', 'Date of Filing');
    const regDate = extractField(tables, summaryFields, 'Registration Date', 'Date of Registration');
    const disposalDate = extractField(tables, summaryFields, 'Disposal Date', 'Date of Disposal');

    if (filingDate) list.push({ date: filingDate, label: 'Case Filed', type: 'filing' });
    if (regDate && regDate !== filingDate) list.push({ date: regDate, label: 'Case Registered', type: 'registration' });

    const histTable = tables.find((t) => {
      const h = (t.title + ' ' + t.headers.join(' ')).toLowerCase();
      return ['hearing', 'history', 'proceeding', 'business', 'listing'].some((kw) => h.includes(kw));
    });
    if (histTable) {
      const dateIdx = histTable.headers.findIndex((h) =>
        ['hearing date', 'date'].some((kw) => h.toLowerCase().includes(kw)),
      );
      const purposeIdx = histTable.headers.findIndex((h) =>
        ['purpose', 'business', 'stage', 'next'].some((kw) => h.toLowerCase().includes(kw)),
      );
      if (dateIdx >= 0) {
        histTable.rows.slice(0, 30).forEach((row) => {
          const date = row[dateIdx] ?? '';
          if (!date || date === '—') return;
          const purpose = purposeIdx >= 0 ? (row[purposeIdx] ?? '') : '';
          list.push({ date, label: purpose ? `Hearing — ${purpose}` : 'Hearing', type: 'hearing' });
        });
      }
    }

    const orderTable = tables.find((t) =>
      ['order', 'judgment'].some((kw) => (t.title + t.headers.join(' ')).toLowerCase().includes(kw)),
    );
    if (orderTable) {
      const dateIdx = orderTable.headers.findIndex((h) => h.toLowerCase().includes('date'));
      if (dateIdx >= 0) {
        orderTable.rows.slice(0, 10).forEach((row) => {
          const date = row[dateIdx] ?? '';
          if (!date || date === '—') return;
          list.push({ date, label: 'Order', type: 'order' });
        });
      }
    }

    if (disposalDate) list.push({ date: disposalDate, label: 'Case Disposed', type: 'disposal' });

    list.sort((a, b) => normDateStr(a.date).localeCompare(normDateStr(b.date)));
    return list;
  }, [tables, summaryFields]);

  if (events.length === 0) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        Timeline data not available in the extracted response.
      </p>
    );
  }

  const dotColor: Record<TimelineEventType, string> = {
    filing: 'bg-blue-500',
    registration: 'bg-green-500',
    hearing: 'bg-amber-400',
    order: 'bg-purple-500',
    disposal: 'bg-red-500',
    other: 'bg-muted-foreground',
  };

  return (
    <div className="relative pl-7">
      <div className="absolute left-2.5 top-1 bottom-1 w-px bg-border" />
      <div className="space-y-2.5">
        {events.map((ev, i) => (
          <div key={`${ev.date}-${i}`} className="relative">
            <div className={cn('absolute -left-5 top-3 h-2.5 w-2.5 rounded-full ring-2 ring-background', dotColor[ev.type])} />
            <div className="rounded-md border bg-card px-3 py-2 text-sm">
              <span className="font-mono text-[10px] text-muted-foreground">{ev.date}</span>
              <p className="mt-0.5 font-medium text-xs">{ev.label}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── CNR extraction helper ────────────────────────────────────────────────────

const CNR_REGEX = /[A-Z]{4}[0-9]{12}/g;

function extractCnrNumbers(record: MatchedRecord): string[] {
  const sources = [
    record.causeList.cnr_number ?? '',
    record.case.cnr_number ?? '',
    record.causeList.party_names ?? '',
    record.causeList.case_number ?? '',
  ];
  const found = new Set<string>();
  for (const src of sources) {
    const matches = src.toUpperCase().match(CNR_REGEX) ?? [];
    for (const m of matches) found.add(m);
  }
  return [...found].filter(Boolean);
}

// ─── Single-CNR panel (reused inside multi-CNR tabs) ─────────────────────────

function CaseDetailPanel({
  details,
  cnrNumber,
  localCase,
}: {
  details: CaseDetailsResponse;
  cnrNumber: string | null;
  localCase: Case | null;
}) {
  const tables = details.tables ?? [];
  const links = details.links ?? [];
  const summaryFields = details.summary_fields ?? {};
  const { grouped } = useMemo(() => groupTablesBySection(tables), [tables]);
  const defaultOpen = ['case-summary', 'case-status', 'parties', 'hearing-history', 'orders', 'documents', 'scrutiny'];

  const prayerRows = useMemo(() => {
    const rows: string[][] = [];
    if (localCase?.prayer) rows.push(['Prayer', localCase.prayer]);
    if (localCase?.subject_matter) rows.push(['Subject Matter', localCase.subject_matter]);
    if (localCase?.last_hearing_update) rows.push(['Last Hearing Update', localCase.last_hearing_update]);
    if (localCase?.nature_of_disposal) rows.push(['Nature of Disposal', localCase.nature_of_disposal]);
    return rows;
  }, [localCase]);

  const topFields = useMemo(() => ({
    cnr:        details.cnr_number || cnrNumber || extractField(tables, summaryFields, 'CNR Number', 'CNR'),
    caseNumber: details.case_number || extractField(tables, summaryFields, 'Registration Number', 'Registration No', 'Case Number', 'Case No'),
    filingNum:  extractField(tables, summaryFields, 'Filing Number', 'Filing No', 'Diary Number', 'Diary No'),
    regNum:     extractField(tables, summaryFields, 'Registration Number', 'Registration No', 'Reg No', 'Reg. No'),
    status:     extractField(tables, summaryFields, 'Case Status', 'Current Status', 'Nature of Disposal', 'Stage'),
    caseType:   extractField(tables, summaryFields, 'Judicial Branch', 'Category', 'Case Type', 'Type of Case'),
    court:      extractField(tables, summaryFields, 'Coram', 'Court Name', 'High Court', 'Court'),
    bench:      extractField(tables, summaryFields, 'Bench Type', 'Bench Name', 'Bench'),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [tables, summaryFields, details.cnr_number, details.case_number, cnrNumber]);

  const statusVariant = (s: string) => {
    const lower = s.toLowerCase();
    if (lower.includes('pending')) return 'warning' as const;
    if (lower.includes('disposed')) return 'secondary' as const;
    if (lower.includes('active')) return 'success' as const;
    return 'outline' as const;
  };

  const sectionContent = (key: SectionKey) => {
    if (key === 'case-timeline') {
      return <TimelineSection tables={tables} summaryFields={summaryFields} />;
    }
    if (key === 'parties' && prayerRows.length > 0) {
      const sectionTables = grouped.get(key) ?? [];
      return (
        <div className="space-y-4">
          {sectionTables.map((t, i) => <DynamicTable key={`${key}-${i}`} table={t} />)}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Prayer &amp; Case Notes</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {prayerRows.map(([label, value]) => (
                <div key={label} className="space-y-1 rounded-md border bg-muted/20 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className="text-sm leading-relaxed">{value}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      );
    }
    const sectionTables = grouped.get(key) ?? [];
    const sectionLinks = getLinksForSection(key, links);
    if (sectionTables.length === 0 && sectionLinks.length === 0) {
      return <p className="py-2 text-sm text-muted-foreground">No data found for this section.</p>;
    }
    return (
      <div className="space-y-4">
        {sectionTables.map((t, i) => <DynamicTable key={`${key}-${i}`} table={t} />)}
      </div>
    );
  };

  const isMappingMissing = details.error === 'CASE_TYPE_MAPPING_NOT_FOUND';
  const hasContent = (details.tables?.length ?? 0) > 0 || (details.text ?? '').trim().length > 0;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Summary strip */}
      {Object.values(topFields).some(Boolean) && (
        <div className="shrink-0 border-b bg-muted/30 px-4 py-3">
          <div className="flex gap-3 overflow-x-auto pb-1">
            {topFields.cnr && (
              <div className="shrink-0 rounded-md border bg-card px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">CNR</p>
                <p className="mt-0.5 font-mono text-xs font-bold">{topFields.cnr}</p>
              </div>
            )}
            {topFields.caseNumber && (
              <div className="shrink-0 rounded-md border bg-card px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Case No</p>
                <p className="mt-0.5 font-mono text-xs font-bold">{topFields.caseNumber}</p>
              </div>
            )}
            {topFields.status && (
              <div className="shrink-0 rounded-md border bg-card px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
                <div className="mt-1"><Badge variant={statusVariant(topFields.status)} className="text-[10px]">{topFields.status}</Badge></div>
              </div>
            )}
            {topFields.caseType && (
              <div className="shrink-0 rounded-md border bg-card px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Case Type</p>
                <p className="mt-0.5 text-xs font-semibold">{topFields.caseType}</p>
              </div>
            )}
            {topFields.bench && (
              <div className="shrink-0 rounded-md border bg-card px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Bench</p>
                <p className="mt-0.5 text-xs font-semibold">{topFields.bench}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {isMappingMissing && (
        <div className="m-4 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Case type not yet configured for eCourts lookup</p>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded border bg-background p-3 space-y-1">
              <p className="text-muted-foreground uppercase tracking-wide font-semibold text-[10px]">Parsed Case Type</p>
              <p className="font-mono font-bold text-destructive">{details.parsedCaseType ?? '—'}</p>
            </div>
          </div>
        </div>
      )}

      {!isMappingMissing && !hasContent && (
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">No case details available.</p>
        </div>
      )}

      {!isMappingMissing && hasContent && (
        <ScrollArea className="flex-1">
          <div className="px-4 py-4 pb-10">
            <Accordion type="multiple" defaultValue={defaultOpen} className="w-full">
              {SECTION_CONFIG.map((section) => (
                <AccordionItem key={section.key} value={section.key} className="border-b">
                  <AccordionTrigger className="py-3 text-sm font-medium hover:no-underline">
                    <span className="flex items-center gap-2">
                      {section.title}
                      {section.key !== 'case-timeline' &&
                        (grouped.get(section.key as SectionKey) ?? []).length > 0 && (
                          <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                            {(grouped.get(section.key as SectionKey) ?? []).length}
                          </Badge>
                        )}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="pb-2">{sectionContent(section.key as SectionKey)}</div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

// ─── MHC Order Panel ─────────────────────────────────────────────────────────

function MhcOrderPanel({
  result,
  onLoadHistory,
  loadingHistory,
}: {
  result: MhcStatusResult;
  onLoadHistory: () => void;
  loadingHistory: boolean;
}) {
  if (!result.orders || result.orders.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">No orders found for this case on MHC.</p>
        <Button variant="outline" size="sm" onClick={onLoadHistory} disabled={loadingHistory}>
          <Clock className="h-3.5 w-3.5 mr-1.5" />
          {loadingHistory ? 'Loading history…' : 'Load Case History (eCourts)'}
        </Button>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-4 p-4">
        {result.orders.map((order, i) => (
          <Card key={i}>
            <CardContent className="p-4 space-y-3">
              {/* Case header */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-sm font-bold">{order.caseno || result.case_number}</p>
                  <p className="text-xs text-muted-foreground">{order.jud1}</p>
                </div>
                {order.juddate && (
                  <div className="shrink-0 rounded-md border bg-muted/30 px-2 py-1 text-center">
                    <p className="text-[10px] text-muted-foreground">Order Date</p>
                    <p className="text-xs font-semibold">{order.juddate}</p>
                  </div>
                )}
              </div>

              {/* Parties */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-md border bg-muted/20 p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Petitioner</p>
                  <p className="font-medium">{order.petname || '—'}</p>
                </div>
                <div className="rounded-md border bg-muted/20 p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Respondent</p>
                  <p className="font-medium">{order.resname || '—'}</p>
                </div>
              </div>

              {/* PDF link */}
              {order.pdf_url && (
                <a
                  href={order.pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  <FileText className="h-3.5 w-3.5" />
                  View Order PDF
                  <ExternalLink className="h-3 w-3 opacity-60" />
                </a>
              )}

              {order.citno && (
                <p className="text-[11px] text-muted-foreground">Citation: {order.citno}</p>
              )}
            </CardContent>
          </Card>
        ))}

        {/* Load full eCourts history */}
        <div className="flex justify-center pt-2 pb-4">
          <Button variant="outline" size="sm" onClick={onLoadHistory} disabled={loadingHistory}>
            <Clock className="h-3.5 w-3.5 mr-1.5" />
            {loadingHistory ? 'Loading full history…' : 'Load Full Case History (eCourts)'}
          </Button>
        </div>
      </div>
    </ScrollArea>
  );
}

// ─── Main Case Details Modal ──────────────────────────────────────────────────

function CaseDetailsModal({
  open,
  onOpenChange,
  loading,
  loadingMessage,
  error,
  details,
  allResults,
  cnrNumber,
  onRetry,
  localCase,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  loadingMessage: string;
  error: string | null;
  details: CaseDetailsResponse | null;
  allResults: CaseDetailsResponse[];
  cnrNumber: string | null;
  onRetry: () => void;
  localCase: Case | null;
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (loading) {
      setElapsedSeconds(0);
      intervalRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [loading]);

  const [activeTab, setActiveTab] = useState('0');
  useEffect(() => { if (open) setActiveTab('0'); }, [open]);

  const isMulti = allResults.length > 1;
  // Use allResults if available, else fall back to single details
  const resultsToShow = allResults.length > 0 ? allResults : (details ? [details] : []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col gap-0 overflow-hidden p-0"
        style={{ width: '90vw', maxWidth: '90vw', height: '90vh', maxHeight: '90vh' }}
      >
        {/* Fixed header */}
        <DialogHeader className="shrink-0 border-b bg-background px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <DialogTitle className="text-lg">Case Details</DialogTitle>
              <DialogDescription className="font-mono text-xs">
                {loading
                  ? loadingMessage
                  : isMulti
                    ? `${resultsToShow.length} case histories found`
                    : `CNR: ${details?.cnr_number || cnrNumber || '—'}`}
              </DialogDescription>
            </div>
            {!isMulti && details?.searchType && (
              <Badge variant="outline" className="mt-1 shrink-0">{details.searchType}</Badge>
            )}
          </div>
        </DialogHeader>

        {/* Loading */}
        {loading && (
          <div className="flex flex-1 flex-col gap-4 overflow-auto p-6">
            <LoadingDetails elapsedSeconds={elapsedSeconds} />
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm font-medium text-destructive">Unable to fetch case details.</p>
            <p className="text-xs text-muted-foreground whitespace-pre-wrap max-w-md">{error}</p>
            {error.includes('HTTP 500') && (
              <p className="text-xs text-amber-700 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 max-w-md">
                eCourts lookups require more than 10 seconds. This works when running
                locally via <code className="font-mono">npm run dev</code>.
                On Vercel production, upgrade to Pro plan for a 60-second function timeout.
              </p>
            )}
            <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>
          </div>
        )}

        {/* No content */}
        {!loading && !error && resultsToShow.length === 0 && (
          <div className="flex flex-1 items-center justify-center p-6">
            <p className="text-sm text-muted-foreground">No case details available for this record.</p>
          </div>
        )}

        {/* Single result — same as before */}
        {!loading && !error && resultsToShow.length === 1 && (
          <CaseDetailPanel details={resultsToShow[0]} cnrNumber={cnrNumber} localCase={localCase} />
        )}

        {/* Multiple results — tabbed */}
        {!loading && !error && resultsToShow.length > 1 && (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
            <TabsList className="shrink-0 mx-4 mt-3 flex-wrap h-auto gap-1 justify-start bg-muted/50 p-1">
              {resultsToShow.map((r, i) => (
                <TabsTrigger
                  key={i}
                  value={String(i)}
                  className="font-mono text-xs data-[state=active]:bg-background"
                >
                  {r.cnr_number || `History ${i + 1}`}
                </TabsTrigger>
              ))}
            </TabsList>
            {resultsToShow.map((r, i) => (
              <TabsContent key={i} value={String(i)} className="flex-1 min-h-0 mt-0 overflow-hidden flex flex-col">
                <CaseDetailPanel details={r} cnrNumber={r.cnr_number ?? null} localCase={i === 0 ? localCase : null} />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Notification Status Badge ─────────────────────────────────────────────────

function NotifStatusBadge({ status }: { status: CauseListNotifStatus | undefined }) {
  if (!status) return null;
  const map: Record<CauseListNotifStatus, { label: string; variant: 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' }> = {
    not_notified:  { label: 'Not Notified', variant: 'secondary' },
    notified:      { label: 'Notified',     variant: 'success' },
    partial:       { label: 'Partial',      variant: 'warning' },
    failed:        { label: 'Failed',       variant: 'destructive' },
    no_recipients: { label: 'No Recipients', variant: 'outline' },
  };
  const { label, variant } = map[status];
  return <Badge variant={variant} className="text-[10px] whitespace-nowrap">{label}</Badge>;
}

// ── Notify Modal ──────────────────────────────────────────────────────────────

function buildMessage(record: MatchedRecord, recipientName: string): { subject: string; message: string } {
  const cl = record.causeList;
  const c  = record.case;
  const subject = `Court Listing Alert — ${c.case_number}`;
  const message =
`Dear ${recipientName},

This is to inform you that the following case has been listed before the court.

Case Number: ${c.case_number}
CNR Number: ${cl.cnr_number ?? c.cnr_number ?? '—'}
Court: Madras High Court
Bench: Chennai
Court Hall: ${cl.court_hall ?? '—'}
Item Number: ${cl.item_number ?? '—'}
Judge: ${cl.judge_name ?? '—'}
Stage: ${cl.last_hearing_or_stage ?? '—'}
Cause List Date: ${cl.cause_date}

Petitioner: ${cl.petitioner ?? c.petitioner ?? '—'}
Respondent: ${cl.respondent ?? c.respondent ?? '—'}

Please take necessary action.

Regards,
Litigo`;
  return { subject, message };
}

interface RecipientSelection {
  recipient: CaseNotificationRecipient;
  sendEmail: boolean;
  sendSms: boolean;
  sendWhatsapp: boolean;
}

function NotifyModal({ record, onClose, causeDate }: {
  record: MatchedRecord | null;
  onClose: () => void;
  causeDate: string | null;
}) {
  const [recipients, setRecipients] = useState<CaseNotificationRecipient[]>([]);
  const [loading, setLoading] = useState(false);
  const [selections, setSelections] = useState<RecipientSelection[]>([]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!record) return;
    setLoading(true);
    const { subject: s, message: m } = buildMessage(record, 'Recipient');
    setSubject(s);
    setMessage(m);
    (async () => {
      const { data } = await supabase
        .from('case_notification_recipients')
        .select('*')
        .eq('case_id', record.case.id)
        .eq('active', true)
        .order('created_at');
      const recs = (data ?? []) as CaseNotificationRecipient[];
      setRecipients(recs);
      setSelections(recs.map(r => ({
        recipient: r,
        sendEmail: r.notify_email && !!r.email,
        sendSms: r.notify_sms && !!r.mobile_number,
        sendWhatsapp: r.notify_whatsapp && !!r.whatsapp_number,
      })));
      setLoading(false);
    })();
  }, [record]);

  async function handleSend() {
    if (!record) return;
    const payload = {
      case_id: record.case.id,
      cause_date: causeDate,
      subject,
      message,
      recipients: selections
        .filter(s => s.sendEmail || s.sendSms || s.sendWhatsapp)
        .map(s => ({
          recipient_id: s.recipient.id,
          send_email: s.sendEmail,
          send_sms: s.sendSms,
          send_whatsapp: s.sendWhatsapp,
        })),
    };
    if (payload.recipients.length === 0) {
      toast.error('Select at least one recipient and channel.');
      return;
    }
    setSending(true);
    try {
      const resp = await fetch('/api/notifications/send-case-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await resp.json();
      if (resp.ok) {
        toast.success(`Sent ${result.sent ?? 0}, Failed ${result.failed ?? 0}.`);
        onClose();
      } else {
        toast.error(result.detail ?? 'Failed to send notifications.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send notifications.');
    } finally {
      setSending(false);
    }
  }

  function toggleChannel(idx: number, channel: 'sendEmail' | 'sendSms' | 'sendWhatsapp') {
    setSelections(prev => prev.map((s, i) => i === idx ? { ...s, [channel]: !s[channel] } : s));
  }

  if (!record) return null;
  const cl = record.causeList;
  const c  = record.case;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4" /> Send Case Notification
          </DialogTitle>
          <DialogDescription>Preview and send a cause list alert to the configured recipients.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* Case Summary */}
          <div className="rounded-md border bg-muted/30 p-3 grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-muted-foreground">Case No:</span> <strong>{c.case_number}</strong></div>
            <div><span className="text-muted-foreground">CNR:</span> <strong>{cl.cnr_number ?? c.cnr_number ?? '—'}</strong></div>
            <div><span className="text-muted-foreground">Court Hall:</span> <strong>{cl.court_hall ?? '—'}</strong></div>
            <div><span className="text-muted-foreground">Item No:</span> <strong>{cl.item_number ?? '—'}</strong></div>
            <div><span className="text-muted-foreground">Judge:</span> <strong>{cl.judge_name ?? '—'}</strong></div>
            <div><span className="text-muted-foreground">Stage:</span> <strong>{cl.last_hearing_or_stage ?? '—'}</strong></div>
            <div><span className="text-muted-foreground">Date:</span> <strong>{cl.cause_date}</strong></div>
            <div><span className="text-muted-foreground">Petitioner:</span> <span className="truncate">{cl.petitioner ?? '—'}</span></div>
          </div>

          {/* Recipients */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recipients</Label>
            {loading && <p className="text-xs text-muted-foreground">Loading recipients…</p>}
            {!loading && recipients.length === 0 && (
              <p className="text-xs text-muted-foreground rounded-md border border-dashed p-3 text-center">
                No active notification recipients configured for this case.
              </p>
            )}
            {selections.map((sel, idx) => (
              <div key={sel.recipient.id} className="rounded-md border px-3 py-2 space-y-1">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{sel.recipient.recipient_name}</p>
                    {sel.recipient.recipient_role && <p className="text-xs text-muted-foreground">{sel.recipient.recipient_role}</p>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 text-xs">
                  {sel.recipient.email && (
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <Switch
                        checked={sel.sendEmail}
                        onCheckedChange={() => toggleChannel(idx, 'sendEmail')}
                        className="scale-75"
                      />
                      Email <span className="text-muted-foreground">({sel.recipient.email})</span>
                    </label>
                  )}
                  {sel.recipient.mobile_number && (
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <Switch
                        checked={sel.sendSms}
                        onCheckedChange={() => toggleChannel(idx, 'sendSms')}
                        className="scale-75"
                        disabled
                      />
                      SMS <Badge variant="outline" className="text-[9px] px-1">Soon</Badge>
                    </label>
                  )}
                  {sel.recipient.whatsapp_number && (
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <Switch
                        checked={sel.sendWhatsapp}
                        onCheckedChange={() => toggleChannel(idx, 'sendWhatsapp')}
                        className="scale-75"
                        disabled
                      />
                      WhatsApp <Badge variant="outline" className="text-[9px] px-1">Soon</Badge>
                    </label>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Subject */}
          <div className="space-y-1.5">
            <Label>Subject</Label>
            <Input value={subject} onChange={e => setSubject(e.target.value)} />
          </div>

          {/* Message */}
          <div className="space-y-1.5">
            <Label>Message</Label>
            <Textarea rows={12} value={message} onChange={e => setMessage(e.target.value)} className="font-mono text-xs" />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSend} disabled={sending || recipients.length === 0} className="gap-1.5">
            <Send className="h-3.5 w-3.5" />
            {sending ? 'Sending…' : 'Send Notification'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TodaysListingsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [causeDate, setCauseDate] = useState<string | null>(null);
  const [totalCauseListCount, setTotalCauseListCount] = useState(0);
  const [matchedRecords, setMatchedRecords] = useState<MatchedRecord[]>([]);
  // case_number strings currently being resolved via /api/lookup-cnr
  const [notifStatusMap, setNotifStatusMap] = useState<Map<string, CauseListNotifStatus>>(new Map());
  const [notifyRecord, setNotifyRecord] = useState<MatchedRecord | null>(null);

  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Fetching case details from eCourts...');
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<MatchedRecord | null>(null);
  const [caseDetails, setCaseDetails] = useState<CaseDetailsResponse | null>(null);
  const [caseDetailsResults, setCaseDetailsResults] = useState<CaseDetailsResponse[]>([]);
  const [mhcResult] = useState<null>(null);
  const [mhcLoading] = useState(false);

  const [captchaDialogOpen, setCaptchaDialogOpen] = useState(false);
  const [captchaValue, setCaptchaValue] = useState('');
  const [captchaImage, setCaptchaImage] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaMessage, setCaptchaMessage] = useState<string | null>(null);
  const [captchaSubmitting, setCaptchaSubmitting] = useState(false);

  const [search, setSearch] = useState('');
  const [filterCourtHall, setFilterCourtHall] = useState('');
  const [filterJudge, setFilterJudge] = useState('');
  const [filterMatchType, setFilterMatchType] = useState('');

  const [sortField, setSortField] = useState<SortField>('court_hall');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Step 1+2: Fetch cause list from Supabase AND user cases in parallel
      const fetchCauseList = async (): Promise<DailyCauseListRecord[]> => {
        // Find most recent available cause_date
        const { data: dateRow, error: dateErr } = await supabase
          .from('daily_cause_list')
          .select('cause_date')
          .eq('court_name', 'Madras High Court')
          .eq('bench', 'Chennai')
          .order('cause_date', { ascending: false })
          .limit(1)
          .single();

        if (dateErr || !dateRow) throw new Error('No cause list data available in the database.');

        const causeDate = (dateRow as { cause_date: string }).cause_date;
        const COLS = 'cause_date,court_name,bench,court_hall,item_number,case_number,cnr_number,petitioner,respondent,party_names,judge_name,last_hearing_or_stage,counsel_name';
        const PAGE = 1000;
        const allRows: DailyCauseListRecord[] = [];
        let offset = 0;
        while (true) {
          const { data, error } = await supabase
            .from('daily_cause_list')
            .select(COLS)
            .eq('cause_date', causeDate)
            .eq('court_name', 'Madras High Court')
            .eq('bench', 'Chennai')
            .order('court_hall', { ascending: true })
            .order('item_number', { ascending: true })
            .range(offset, offset + PAGE - 1);
          if (error) throw new Error(error.message);
          if (!data || data.length === 0) break;
          allRows.push(...(data as DailyCauseListRecord[]));
          if (data.length < PAGE) break;
          offset += PAGE;
        }
        return allRows;
      };

      const [causeListRows, casesResult] = await Promise.all([
        fetchCauseList(),
        supabase.from('cases').select('*').order('created_at', { ascending: false }),
      ]);

      if (casesResult.error) throw casesResult.error;

      const today = new Date().toISOString().split('T')[0];
      setCauseDate(causeListRows[0]?.cause_date ?? today);
      setTotalCauseListCount(causeListRows.length);

      // Step 3: Fetch user's cases from Supabase result
      const cases = (casesResult.data ?? []) as Case[];
      if (cases.length === 0) {
        setMatchedRecords([]);
        setLoading(false);
        return;
      }

      // Step 3: Build lookup maps FROM the cause list
      // Also build a normalized map to handle format differences
      // e.g. "WP/1234/2026" vs "W.P.No.1234/2026" both normalize to "WP12342026"
      function normCaseNum(s: string): string {
        return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
      }

      const clByCnr = new Map<string, DailyCauseListRecord>();
      const clByCaseNum = new Map<string, DailyCauseListRecord>();
      const clByNormCaseNum = new Map<string, DailyCauseListRecord>();

      for (const row of causeListRows) {
        if (row.cnr_number?.trim()) {
          clByCnr.set(row.cnr_number.trim().toLowerCase(), row);
        }
        if (row.case_number?.trim()) {
          clByCaseNum.set(row.case_number.trim().toLowerCase(), row);
          const norm = normCaseNum(row.case_number);
          if (norm) clByNormCaseNum.set(norm, row);
        }
      }

      // Step 4: For each case in the cases table, look it up in today's cause list.
      // CNR match is tried first (exact), then exact case_number, then normalized case_number.
      // If matched by case_number and case has a CNR, back-fill it onto the cause list row
      // so eCourts lookups skip captcha.
      const seen = new Set<string>(); // dedup by cause list row
      const merged: MatchedRecord[] = [];

      for (const c of cases) {
        // CNR match
        const cnrKey = c.cnr_number?.trim().toLowerCase();
        if (cnrKey && clByCnr.has(cnrKey)) {
          const row = clByCnr.get(cnrKey)!;
          const rowKey = `${row.court_hall}|${row.item_number}|${row.case_number}`;
          if (!seen.has(rowKey)) {
            seen.add(rowKey);
            console.log('[Listings match] CNR:', c.cnr_number, '→ CL case:', row.case_number, '| Internal case:', c.case_number);
            // Cause list XML never includes CNRs — always pull from case table
            const enrichedRow: DailyCauseListRecord = c.cnr_number?.trim()
              ? { ...row, cnr_number: c.cnr_number.trim() }
              : row;
            merged.push({ causeList: enrichedRow, case: c, matchType: 'cnr', matchedBy: `CNR: ${c.cnr_number}` });
            continue;
          }
        }

        // Case number match (exact, then normalized)
        const caseNum = c.case_number?.trim() ?? '';
        if (caseNum) {
          const exactRow = clByCaseNum.get(caseNum.toLowerCase());
          const normRow = !exactRow ? clByNormCaseNum.get(normCaseNum(caseNum)) : undefined;
          const row = exactRow ?? normRow;
          if (row) {
            const rowKey = `${row.court_hall}|${row.item_number}|${row.case_number}`;
            if (!seen.has(rowKey)) {
              seen.add(rowKey);
              const matchedBy = exactRow
                ? `Case No (exact): ${caseNum}`
                : `Case No (normalized): ${caseNum} ≈ ${row.case_number}`;
              console.log('[Listings match]', matchedBy, '| Internal case:', c.case_number);
              // Use the cause list row as-is; CNR will be fetched from eCourts API below
              merged.push({ causeList: row, case: c, matchType: 'case_number', matchedBy });
            }
          }
        }
      }

      setMatchedRecords(merged);

      // Step 5: Load notification status for all matched cases
      if (merged.length > 0) {
        const caseIds = merged.map(r => r.case.id);
        const currentCauseDate = causeListRows[0]?.cause_date ?? new Date().toISOString().split('T')[0];
        const [logsResult, recipientsResult] = await Promise.all([
          supabase
            .from('notification_logs')
            .select('case_id,status')
            .in('case_id', caseIds)
            .eq('cause_date', currentCauseDate),
          supabase
            .from('case_notification_recipients')
            .select('case_id')
            .in('case_id', caseIds)
            .eq('active', true),
        ]);
        const logs = (logsResult.data ?? []) as Pick<NotificationLog, 'case_id' | 'status'>[];
        const activeRecipientCaseIds = new Set((recipientsResult.data ?? []).map((r: { case_id: string }) => r.case_id));

        const statusMap = new Map<string, CauseListNotifStatus>();
        for (const caseId of caseIds) {
          const caseLogs = logs.filter(l => l.case_id === caseId);
          if (caseLogs.length === 0) {
            statusMap.set(caseId, activeRecipientCaseIds.has(caseId) ? 'not_notified' : 'no_recipients');
          } else {
            const sent   = caseLogs.filter(l => l.status === 'sent').length;
            const failed = caseLogs.filter(l => l.status === 'failed').length;
            if (failed === 0) statusMap.set(caseId, 'notified');
            else if (sent === 0) statusMap.set(caseId, 'failed');
            else statusMap.set(caseId, 'partial');
          }
        }
        setNotifStatusMap(statusMap);
      }

      // Step 6: For case_number-matched records without a CNR, auto-resolve via eCourts API
      const needsCnr = merged.filter(
        (r) => r.matchType === 'case_number' && !r.causeList.cnr_number?.trim() && r.causeList.case_number?.trim(),
      );
      if (needsCnr.length > 0) {
        needsCnr.forEach(async (r) => {
          const caseNumber = r.causeList.case_number!.trim();
          try {
            const resp = await fetch('/api/lookup-cnr', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ case_number: caseNumber }),
            });
            if (resp.ok) {
              const data = await resp.json();
              if (data.success && data.cnr_number) {
                console.log('[lookup-cnr] resolved', caseNumber, '→', data.cnr_number);
                setMatchedRecords((prev) =>
                  prev.map((mr) =>
                    mr.causeList.case_number?.trim() === caseNumber
                      ? { ...mr, causeList: { ...mr.causeList, cnr_number: data.cnr_number } }
                      : mr,
                  ),
                );
              }
            }
          } catch (err) {
            console.warn('[lookup-cnr] failed for', caseNumber, err);
          }
        });
      }
    } catch (err) {
      console.error('[TodaysListingsPage] fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load listings. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const courtHallOptions = useMemo(
    () => [...new Set(matchedRecords.map((record) => record.causeList.court_hall).filter(Boolean))].sort() as string[],
    [matchedRecords],
  );

  const judgeOptions = useMemo(
    () => [...new Set(matchedRecords.map((record) => record.causeList.judge_name).filter(Boolean))].sort() as string[],
    [matchedRecords],
  );

  const cnrMatchCount = useMemo(
    () => matchedRecords.filter((record) => record.matchType === 'cnr').length,
    [matchedRecords],
  );

  const caseNumMatchCount = useMemo(
    () => matchedRecords.filter((record) => record.matchType === 'case_number').length,
    [matchedRecords],
  );

  const filtered = useMemo(() => {
    let rows = matchedRecords;

    if (filterCourtHall) rows = rows.filter((record) => record.causeList.court_hall === filterCourtHall);
    if (filterJudge) rows = rows.filter((record) => record.causeList.judge_name === filterJudge);
    if (filterMatchType) rows = rows.filter((record) => record.matchType === filterMatchType);

    if (search.trim()) {
      const query = search.trim().toLowerCase();
      rows = rows.filter((record) => {
        const causeList = record.causeList;
        const currentCase = record.case;
        return [
          causeList.cnr_number,
          causeList.case_number,
          causeList.petitioner,
          causeList.respondent,
          causeList.counsel_name,
          currentCase.cnr_number,
          currentCase.case_number,
          currentCase.petitioner,
          currentCase.respondent,
          currentCase.advocate_name,
          currentCase.client_name,
        ].some((value) => value?.toLowerCase().includes(query));
      });
    }

    return [...rows].sort((left, right) => {
      let leftValue = '';
      let rightValue = '';

      switch (sortField) {
        case 'court_hall':
          leftValue = left.causeList.court_hall ?? '';
          rightValue = right.causeList.court_hall ?? '';
          break;
        case 'item_number':
          leftValue = left.causeList.item_number ?? '';
          rightValue = right.causeList.item_number ?? '';
          break;
        case 'case_number':
          leftValue = left.causeList.case_number ?? '';
          rightValue = right.causeList.case_number ?? '';
          break;
        case 'next_hearing_date':
          leftValue = left.case.next_hearing_date ?? '';
          rightValue = right.case.next_hearing_date ?? '';
          break;
      }

      const comparison = leftValue.localeCompare(rightValue, undefined, { numeric: true });
      return sortDir === 'asc' ? comparison : -comparison;
    });
  }, [matchedRecords, search, filterCourtHall, filterJudge, filterMatchType, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const hasActiveFilters = search || filterCourtHall || filterJudge || filterMatchType;

  function clearFilters() {
    setSearch('');
    setFilterCourtHall('');
    setFilterJudge('');
    setFilterMatchType('');
    setPage(1);
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <span className="ml-1 text-muted-foreground/40">↕</span>;
    return <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  // ── eCourts case history ─────────────────────────────────────────────────
  const loadEcourtsHistory = useCallback(async (record: MatchedRecord, captcha?: string, captchaTokenOverride?: string) => {
    if (!record) return;
    setDetailsError(null);
    setCaseDetails(null);
    setCaseDetailsResults([]);

    const cnrs = extractCnrNumbers(record).filter(Boolean);
    const caseNum = normalizeText(record.causeList.case_number) || normalizeText(record.case.case_number);

    // No CNR available — use case number (requires captcha)
    if (cnrs.length === 0 && !captcha) {
      if (!caseNum) {
        setDetailsError('No CNR or case number available.');
        return;
      }
      setDetailsLoading(true);
      setLoadingMessage('Connecting to eCourts…');
      try {
        const res = await fetch('/api/ecourts/case-details', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ case_number: caseNum }),
        });
        let data: CaseDetailsResponse | null = null;
        try { data = (await res.json()) as CaseDetailsResponse; } catch { data = null; }
        if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
        if (data?.requiresCaptcha) {
          setDetailsDialogOpen(false);
          setCaptchaDialogOpen(true);
          setCaptchaValue('');
          setCaptchaImage(data.captchaImage ?? null);
          setCaptchaToken(data.captchaToken ?? null);
          setCaptchaMessage(data.message ?? 'Enter the captcha to continue.');
          return;
        }
        if (!data?.success) { setDetailsError(data?.message || 'eCourts lookup failed.'); return; }
        setCaseDetails(data);
        setCaseDetailsResults([data]);
      } catch (err) {
        setDetailsError(err instanceof Error ? err.message : 'eCourts lookup failed.');
      } finally { setDetailsLoading(false); }
      return;
    }

    // Captcha submit
    if (captcha && cnrs.length === 0) {
      setDetailsLoading(true);
      setLoadingMessage('Submitting captcha…');
      try {
        const res = await fetch('/api/ecourts/case-details', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ case_number: caseNum, captcha: captcha.trim(), captcha_token: captchaTokenOverride ?? '' }),
        });
        let data: CaseDetailsResponse | null = null;
        try { data = (await res.json()) as CaseDetailsResponse; } catch { data = null; }
        if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
        if (data?.requiresCaptcha) {
          setDetailsDialogOpen(false);
          setCaptchaDialogOpen(true);
          setCaptchaValue('');
          setCaptchaImage(data.captchaImage ?? null);
          setCaptchaToken(data.captchaToken ?? null);
          setCaptchaMessage(data.message ?? 'Invalid captcha. Please try again.');
          return;
        }
        if (!data?.success) { setDetailsError(data?.message || 'eCourts lookup failed.'); return; }
        setCaseDetails(data);
        setCaseDetailsResults([data]);
      } catch (err) {
        setDetailsError(err instanceof Error ? err.message : 'eCourts lookup failed.');
      } finally { setDetailsLoading(false); }
      return;
    }

    // CNRs available — fetch each from eCourts
    setDetailsLoading(true);
    const results: CaseDetailsResponse[] = [];
    const errors: string[] = [];
    try {
      for (let i = 0; i < cnrs.length; i++) {
        const cnr = cnrs[i];
        const cacheKey = `case_history_${cnr}`;
        try {
          const cached = sessionStorage.getItem(cacheKey);
          if (cached) {
            const p = JSON.parse(cached) as CaseDetailsResponse;
            if (p.success) { results.push(p); continue; }
          }
        } catch { /* ignore */ }

        setLoadingMessage(`Fetching history ${i + 1}/${cnrs.length}… (${cnr})`);
        try {
          const res = await fetch('/api/ecourts/case-details', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cnr_number: cnr }),
          });
          let data: CaseDetailsResponse | null = null;
          try { data = (await res.json()) as CaseDetailsResponse; } catch { /* ignore */ }
          if (!res.ok) { errors.push(`${cnr}: HTTP ${res.status}`); continue; }
          if (data?.requiresCaptcha) {
            setDetailsDialogOpen(false);
            setCaptchaDialogOpen(true);
            setCaptchaValue('');
            setCaptchaImage(data.captchaImage ?? null);
            setCaptchaToken(data.captchaToken ?? null);
            setCaptchaMessage(data.message ?? 'Captcha required.');
            return;
          }
          if (!data?.success) { errors.push(`${cnr}: ${data?.message ?? 'failed'}`); continue; }
          try { sessionStorage.setItem(cacheKey, JSON.stringify(data)); } catch { /* quota */ }
          results.push(data);
        } catch (e) {
          errors.push(`${cnr}: ${e instanceof Error ? e.message : 'error'}`);
        }
      }
      if (results.length === 0) {
        setDetailsError(errors.length > 0
          ? `eCourts failed:\n${errors.join('\n')}`
          : 'No data returned from eCourts.');
      } else {
        setCaseDetails(results[0]);
        setCaseDetailsResults(results);
      }
    } catch (err) {
      setDetailsError(err instanceof Error ? err.message : 'eCourts lookup failed.');
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  // ── Details button ────────────────────────────────────────────────────────
  const fetchCaseDetails = useCallback(async (record: MatchedRecord) => {
    setSelectedRecord(record);
    setDetailsDialogOpen(true);
    await loadEcourtsHistory(record);
  }, [loadEcourtsHistory]);

  const refreshCaptcha = useCallback(async () => {
    if (!selectedRecord) return;
    setCaptchaSubmitting(true);
    try {
      const caseNum =
        normalizeText(selectedRecord.causeList.case_number) ||
        normalizeText(selectedRecord.case.case_number);
      const res = await fetch('/api/ecourts/case-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_number: caseNum }),
      });
      const data = (await res.json()) as CaseDetailsResponse;
      setCaptchaImage(data.captchaImage ?? null);
      setCaptchaToken(data.captchaToken ?? null);
      setCaptchaMessage(data.message ?? 'Enter the new captcha shown above.');
      setCaptchaValue('');
    } catch {
      setCaptchaMessage('Unable to refresh captcha. Please try again.');
    } finally {
      setCaptchaSubmitting(false);
    }
  }, [selectedRecord]);

  async function submitCaptcha() {
    if (!selectedRecord || !captchaValue.trim()) return;
    setCaptchaSubmitting(true);
    setCaptchaDialogOpen(false);
    await loadEcourtsHistory(selectedRecord, captchaValue.trim(), captchaToken ?? undefined);
    setCaptchaSubmitting(false);
  }

  const retryCaseDetails = useCallback(() => {
    if (selectedRecord) fetchCaseDetails(selectedRecord);
  }, [selectedRecord, fetchCaseDetails]);

  return (
    <>
      <div className="space-y-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">Matched Listings</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Cases listed in today’s Madras High Court cause list that match your tracked cases.
              {causeDate && !loading && (
                <span className="ml-1">
                  · {causeDate === new Date().toISOString().split('T')[0] ? "Today's" : 'Latest available'} cause list:
                  {' '}
                  <span className="font-medium">{fmtDate(causeDate)}</span>
                </span>
              )}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1"
            disabled={loading || isRefreshing}
            onClick={async () => {
              setIsRefreshing(true);
              try {
                await fetchData();
                toast.success('Cause list refreshed successfully.');
              } catch {
                toast.error('Unable to refresh cause list. Please try again.');
              } finally {
                setIsRefreshing(false);
              }
            }}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard title="Total Cause List Records" value={loading ? '—' : totalCauseListCount} />
          <SummaryCard title="Total Matched Records" value={loading ? '—' : matchedRecords.length} />
          <SummaryCard title="CNR Matches" value={loading ? '—' : cnrMatchCount} />
          <SummaryCard title="Case Number Matches" value={loading ? '—' : caseNumMatchCount} />
        </div>

        {!loading && !error && matchedRecords.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search CNR, case no, parties, advocate..."
                className="h-9 pl-8 text-sm"
              />
            </div>

            <Select
              value={filterCourtHall || '__all__'}
              onValueChange={(value) => {
                setFilterCourtHall(value === '__all__' ? '' : value);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 w-40 text-sm">
                <SelectValue placeholder="All Court Halls" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Court Halls</SelectItem>
                {courtHallOptions.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filterJudge || '__all__'}
              onValueChange={(value) => {
                setFilterJudge(value === '__all__' ? '' : value);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 w-52 text-sm">
                <SelectValue placeholder="All Judges" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Judges</SelectItem>
                {judgeOptions.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filterMatchType || '__all__'}
              onValueChange={(value) => {
                setFilterMatchType(value === '__all__' ? '' : value);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 w-44 text-sm">
                <SelectValue placeholder="All Match Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Match Types</SelectItem>
                <SelectItem value="cnr">CNR Match</SelectItem>
                <SelectItem value="case_number">Case Number Match</SelectItem>
              </SelectContent>
            </Select>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" className="h-9 gap-1 text-muted-foreground" onClick={clearFilters}>
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>
        )}

        {loading && (
          <div className="flex justify-center py-24 text-sm text-muted-foreground">Loading matched listings...</div>
        )}

        {!loading && error && (
          <div className="flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
            <Button variant="ghost" size="sm" onClick={() => fetchData()}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && matchedRecords.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
            <p className="text-base font-medium">No tracked cases were found in today's cause list.</p>
            <p className="mt-1 text-sm">
              Ensure your cases have correct CNR or case numbers, and that the cause list has been downloaded for today.
            </p>
          </div>
        )}

        {!loading && !error && matchedRecords.length > 0 && (
          <>
            {filtered.length !== matchedRecords.length && (
              <p className="text-xs text-muted-foreground">Showing {filtered.length} of {matchedRecords.length} matched records</p>
            )}

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('court_hall')}>
                      Court Hall <SortIcon field="court_hall" />
                    </TableHead>
                    <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('item_number')}>
                      Item No <SortIcon field="item_number" />
                    </TableHead>
                    <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('case_number')}>
                      Cause List Case No <SortIcon field="case_number" />
                    </TableHead>
                    <TableHead className="whitespace-nowrap">Internal Case No</TableHead>
                    <TableHead className="whitespace-nowrap">Petitioner</TableHead>
                    <TableHead className="whitespace-nowrap">Respondent</TableHead>
                    <TableHead className="whitespace-nowrap">Judge</TableHead>
                    <TableHead className="whitespace-nowrap">Stage</TableHead>
                    <TableHead className="whitespace-nowrap">Advocate Name</TableHead>
                    <TableHead className="whitespace-nowrap">Client Name</TableHead>
                    <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('next_hearing_date')}>
                      Next Hearing <SortIcon field="next_hearing_date" />
                    </TableHead>
                    <TableHead className="whitespace-nowrap">Match Type</TableHead>
                    <TableHead className="whitespace-nowrap">Notification</TableHead>
                    <TableHead className="whitespace-nowrap">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={14} className="py-10 text-center text-muted-foreground">
                        No records match your search or filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginated.map((record, idx) => (
                      <TableRow key={`${record.causeList.court_hall}-${record.causeList.item_number}-${record.causeList.case_number}-${idx}`}>
                        <TableCell className="whitespace-nowrap font-medium">{record.causeList.court_hall ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap">{record.causeList.item_number ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">{record.causeList.case_number ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">{record.case.case_number ?? '—'}</TableCell>
                        <TableCell className="max-w-[160px] truncate" title={record.causeList.petitioner ?? undefined}>
                          {record.causeList.petitioner ?? '—'}
                        </TableCell>
                        <TableCell className="max-w-[160px] truncate" title={record.causeList.respondent ?? undefined}>
                          {record.causeList.respondent ?? '—'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{record.causeList.judge_name ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap">{record.causeList.last_hearing_or_stage ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap">{record.case.advocate_name ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap">{record.case.client_name ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap">{fmtDate(record.case.next_hearing_date)}</TableCell>
                        <TableCell>
                          <MatchTypeBadge type={record.matchType} matchedBy={record.matchedBy} />
                        </TableCell>
                        <TableCell>
                          <NotifStatusBadge status={notifStatusMap.get(record.case.id)} />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Button variant="outline" size="sm" className="h-7 gap-1.5 whitespace-nowrap text-xs" onClick={() => fetchCaseDetails(record)}>
                              <Eye className="h-3.5 w-3.5" />
                              Details
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1.5 whitespace-nowrap text-xs"
                              title={notifStatusMap.get(record.case.id) === 'no_recipients' ? 'No active notification recipients configured for this case.' : 'Send notification'}
                              disabled={notifStatusMap.get(record.case.id) === 'no_recipients'}
                              onClick={() => setNotifyRecord(record)}
                            >
                              <Bell className="h-3.5 w-3.5" />
                              Notify
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  Showing {(safePage - 1) * PAGE_SIZE + 1}-{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
                </span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={safePage === 1} onClick={() => setPage((current) => current - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="px-2 font-medium text-foreground">{safePage} / {totalPages}</span>
                  <Button variant="ghost" size="icon" className="h-8 w-8" disabled={safePage === totalPages} onClick={() => setPage((current) => current + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Case History Modal */}
      <CaseDetailsModal
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        loading={detailsLoading}
        loadingMessage={loadingMessage}
        error={detailsError}
        details={caseDetails}
        allResults={caseDetailsResults}
        cnrNumber={
          normalizeText(selectedRecord?.causeList.cnr_number) ||
          normalizeText(selectedRecord?.case.cnr_number) ||
          null
        }
        onRetry={retryCaseDetails}
        localCase={selectedRecord?.case ?? null}
      />

      {notifyRecord && (
        <NotifyModal
          record={notifyRecord}
          causeDate={causeDate}
          onClose={() => setNotifyRecord(null)}
        />
      )}

      <Dialog open={captchaDialogOpen} onOpenChange={setCaptchaDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enter Captcha</DialogTitle>
            <DialogDescription>Case number search on eCourts requires captcha verification.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {captchaMessage && <p className="text-sm text-muted-foreground">{captchaMessage}</p>}
            <Card>
              <CardContent className="flex flex-col items-center gap-4 pt-6">
                {captchaImage ? (
                  <img src={captchaImage} alt="eCourts captcha" className="h-16 rounded border bg-white px-2 py-1" />
                ) : (
                  <div className="flex h-16 w-full items-center justify-center rounded border border-dashed text-sm text-muted-foreground">
                    Captcha image unavailable.
                  </div>
                )}
                <div className="flex w-full items-center gap-2">
                  <Input
                    value={captchaValue}
                    onChange={(e) => setCaptchaValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && captchaValue.trim() && submitCaptcha()}
                    placeholder="Enter captcha"
                    autoComplete="off"
                    maxLength={6}
                  />
                  <Button variant="outline" size="icon" onClick={refreshCaptcha} disabled={captchaSubmitting}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCaptchaDialogOpen(false)} disabled={captchaSubmitting}>
                Cancel
              </Button>
              <Button onClick={submitCaptcha} disabled={captchaSubmitting || captchaValue.trim().length === 0}>
                {captchaSubmitting ? 'Submitting...' : 'Fetch Case Details'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

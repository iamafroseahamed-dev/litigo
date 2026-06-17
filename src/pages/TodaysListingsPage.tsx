import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
import { Search, X, Eye, ChevronLeft, ChevronRight, RefreshCw, ExternalLink } from 'lucide-react';
import type { Case } from '@/types';

interface DailyCauseListRecord {
  id: string;
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
  message?: string;
  caseNumber?: string;
  captchaToken?: string;
  captchaImage?: string;
  searchType?: 'CNR' | 'CASE_NUMBER';
  cnr_number?: string;
  case_number?: string;
  text?: string;
  tables?: CaseDetailsTable[];
  links?: CaseDetailsLink[];
  raw_html?: string;
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
  | 'full-content';

const PAGE_SIZE = 20;
const CL_SELECT =
  'id, cause_date, court_name, bench, court_hall, item_number, case_number, cnr_number, petitioner, respondent, party_names, judge_name, last_hearing_or_stage, counsel_name';

const SECTION_CONFIG: Array<{ key: SectionKey; title: string; keywords: string[] }> = [
  {
    key: 'case-summary',
    title: 'Case Summary',
    keywords: ['case summary', 'case details', 'registration', 'filing', 'case type', 'cnr', 'diary'],
  },
  {
    key: 'case-status',
    title: 'Case Status',
    keywords: ['status', 'stage', 'disposal', 'disposed', 'listing status'],
  },
  {
    key: 'parties',
    title: 'Parties',
    keywords: ['party', 'petitioner', 'respondent', 'appellant', 'defendant', 'complainant'],
  },
  {
    key: 'advocates',
    title: 'Advocates',
    keywords: ['advocate', 'counsel', 'lawyer'],
  },
  {
    key: 'acts',
    title: 'Acts / Applicable Laws',
    keywords: ['act', 'law', 'section', 'provision', 'ipc', 'crpc'],
  },
  {
    key: 'hearing-history',
    title: 'Hearing History',
    keywords: ['hearing', 'history', 'proceeding', 'business', 'listing', 'next date'],
  },
  {
    key: 'orders',
    title: 'Orders',
    keywords: ['order', 'judgment', 'pronouncement'],
  },
  {
    key: 'documents',
    title: 'Documents',
    keywords: ['document', 'attachment', 'annexure', 'pdf', 'download'],
  },
  {
    key: 'scrutiny',
    title: 'Scrutiny / Objections',
    keywords: ['scrutiny', 'objection', 'defect', 'deficiency', 'compliance'],
  },
  {
    key: 'full-content',
    title: 'Full Extracted Content',
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

function MatchTypeBadge({ type }: { type: MatchType }) {
  if (type === 'cnr') return <Badge variant="success">CNR Match</Badge>;
  return <Badge variant="info">Case Number Match</Badge>;
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
                          {row[colIndex] || '—'}
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

function LoadingDetails() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
      <Skeleton className="h-10" />
      <Skeleton className="h-40" />
      <Skeleton className="h-32" />
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
      (config) => config.key !== 'full-content' && config.keywords.some((keyword) => haystack.includes(keyword)),
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
  const keywordMap: Record<Exclude<SectionKey, 'full-content'>, string[]> = {
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

  if (section === 'full-content') return links;

  const keywords = keywordMap[section];
  return links.filter((link) => {
    const haystack = `${link.text} ${link.href}`.toLowerCase();
    return keywords.some((keyword) => haystack.includes(keyword));
  });
}

function SectionLinks({ links }: { links: CaseDetailsLink[] }) {
  if (links.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Extracted Links</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {links.map((link, index) => (
          <a
            key={`${link.href}-${index}`}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-sm text-blue-700 hover:underline"
          >
            <ExternalLink className="h-4 w-4" />
            <span className="break-all">{link.text}</span>
          </a>
        ))}
      </CardContent>
    </Card>
  );
}

function CaseDetailsDialog({
  open,
  onOpenChange,
  loading,
  error,
  details,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  details: CaseDetailsResponse | null;
}) {
  const tables = details?.tables ?? [];
  const links = details?.links ?? [];
  const groupedData = useMemo(() => groupTablesBySection(tables), [tables]);
  const defaultOpenSections = SECTION_CONFIG.map((section) => section.key);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>Case Details</DialogTitle>
          <DialogDescription>
            {loading ? 'Fetching case details...' : 'Rendered directly from the Python backend eCourts response.'}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[80vh] px-6 py-4">
          {loading ? (
            <LoadingDetails />
          ) : error ? (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
            </Card>
          ) : !details || ((details.tables?.length ?? 0) === 0 && !(details.text ?? '').trim()) ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">No case details found.</CardContent>
            </Card>
          ) : (
            <div className="space-y-4 pb-6">
              <div className="grid gap-3 md:grid-cols-3">
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Search Type</p>
                    <div className="mt-2">
                      <Badge variant="outline">{details.searchType || '—'}</Badge>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">CNR Number</p>
                    <p className="mt-2 break-all font-mono text-sm">{details.cnr_number || '—'}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Case Number</p>
                    <p className="mt-2 break-all font-mono text-sm">{details.case_number || '—'}</p>
                  </CardContent>
                </Card>
              </div>

              <Accordion type="multiple" defaultValue={defaultOpenSections} className="w-full">
                {SECTION_CONFIG.map((section) => {
                  const grouped = groupedData.grouped.get(section.key) ?? [];
                  const sectionTables = section.key === 'full-content' ? tables : grouped;
                  const sectionLinks = getLinksForSection(section.key, links);

                  return (
                    <AccordionItem key={section.key} value={section.key}>
                      <AccordionTrigger>{section.title}</AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-4">
                          {section.key === 'full-content' ? (
                            <>
                              {sectionTables.map((table, index) => (
                                <DynamicTable key={`${section.key}-${index}-${table.title}`} table={table} />
                              ))}
                              {groupedData.unmatched.length > 0 && (
                                <Card>
                                  <CardHeader className="pb-3">
                                    <CardTitle className="text-base">Uncategorized Extracted Tables</CardTitle>
                                  </CardHeader>
                                  <CardContent className="space-y-4">
                                    {groupedData.unmatched.map((table, index) => (
                                      <DynamicTable key={`unmatched-${index}-${table.title}`} table={table} />
                                    ))}
                                  </CardContent>
                                </Card>
                              )}
                              <SectionLinks links={sectionLinks} />
                              <Card>
                                <CardHeader className="pb-3">
                                  <CardTitle className="text-base">Full Text</CardTitle>
                                </CardHeader>
                                <CardContent>
                                  <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground">
                                    {details.text || 'No extracted text found.'}
                                  </pre>
                                </CardContent>
                              </Card>
                            </>
                          ) : sectionTables.length > 0 || sectionLinks.length > 0 ? (
                            <>
                              {sectionTables.map((table, index) => (
                                <DynamicTable key={`${section.key}-${index}-${table.title}`} table={table} />
                              ))}
                              <SectionLinks links={sectionLinks} />
                            </>
                          ) : (
                            <Card>
                              <CardContent className="pt-6 text-sm text-muted-foreground">
                                No {section.title.toLowerCase()} content found in the extracted response.
                              </CardContent>
                            </Card>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function CaptchaDialog({
  open,
  onOpenChange,
  image,
  value,
  onChange,
  onSubmit,
  onRefresh,
  submitting,
  message,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  image: string | null;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onRefresh: () => void;
  submitting: boolean;
  message: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enter Captcha</DialogTitle>
          <DialogDescription>
            Case number search on eCourts requires a manual captcha entry.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {message && <p className="text-sm text-muted-foreground">{message}</p>}

          <Card>
            <CardContent className="flex flex-col items-center gap-4 pt-6">
              {image ? (
                <img src={image} alt="eCourts captcha" className="h-16 rounded border bg-white px-2 py-1" />
              ) : (
                <div className="flex h-16 w-full items-center justify-center rounded border border-dashed text-sm text-muted-foreground">
                  Captcha image unavailable.
                </div>
              )}

              <div className="flex w-full items-center gap-2">
                <Input
                  value={value}
                  onChange={(event) => onChange(event.target.value)}
                  placeholder="Enter captcha"
                  autoComplete="off"
                  maxLength={6}
                />
                <Button variant="outline" size="icon" onClick={onRefresh} disabled={submitting}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={onSubmit} disabled={submitting || value.trim().length === 0}>
              {submitting ? 'Submitting...' : 'Fetch Case Details'}
            </Button>
          </div>
        </div>
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

  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<MatchedRecord | null>(null);
  const [caseDetails, setCaseDetails] = useState<CaseDetailsResponse | null>(null);

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

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const today = new Date().toISOString().split('T')[0];
      let targetDate = today;

      const { data: todayCheck } = await supabase
        .from('daily_cause_list')
        .select('cause_date')
        .eq('court_name', 'Madras High Court')
        .eq('bench', 'Chennai')
        .eq('cause_date', today)
        .limit(1);

      if (!todayCheck || todayCheck.length === 0) {
        const { data: latestRow } = await supabase
          .from('daily_cause_list')
          .select('cause_date')
          .eq('court_name', 'Madras High Court')
          .eq('bench', 'Chennai')
          .order('cause_date', { ascending: false })
          .limit(1);

        if (latestRow && latestRow.length > 0) {
          targetDate = latestRow[0].cause_date as string;
        } else {
          setCauseDate(null);
          setTotalCauseListCount(0);
          setMatchedRecords([]);
          setLoading(false);
          return;
        }
      }

      setCauseDate(targetDate);

      const { count: totalCount } = await supabase
        .from('daily_cause_list')
        .select('*', { count: 'exact', head: true })
        .eq('cause_date', targetDate)
        .eq('court_name', 'Madras High Court')
        .eq('bench', 'Chennai');

      setTotalCauseListCount(totalCount ?? 0);

      const { data: casesData, error: casesError } = await supabase
        .from('cases')
        .select('*')
        .order('created_at', { ascending: false });

      if (casesError) throw casesError;

      const cases = (casesData ?? []) as Case[];
      if (cases.length === 0) {
        setMatchedRecords([]);
        setLoading(false);
        return;
      }

      const cnrMap = new Map<string, Case>();
      const caseNumMap = new Map<string, Case>();
      const cnrOriginal: string[] = [];
      const caseNumOriginal: string[] = [];

      for (const currentCase of cases) {
        if (currentCase.cnr_number?.trim()) {
          const key = currentCase.cnr_number.trim().toLowerCase();
          if (!cnrMap.has(key)) {
            cnrMap.set(key, currentCase);
            cnrOriginal.push(currentCase.cnr_number.trim());
          }
        }

        if (currentCase.case_number?.trim()) {
          const key = currentCase.case_number.trim().toLowerCase();
          if (!caseNumMap.has(key)) {
            caseNumMap.set(key, currentCase);
            caseNumOriginal.push(currentCase.case_number.trim());
          }
        }
      }

      const cnrResultsRaw: DailyCauseListRecord[] = [];
      if (cnrOriginal.length > 0) {
        const { data, error: cnrError } = await supabase
          .from('daily_cause_list')
          .select(CL_SELECT)
          .eq('cause_date', targetDate)
          .eq('court_name', 'Madras High Court')
          .eq('bench', 'Chennai')
          .in('cnr_number', cnrOriginal);
        if (cnrError) throw cnrError;
        if (data) cnrResultsRaw.push(...(data as DailyCauseListRecord[]));
      }

      const caseNumResultsRaw: DailyCauseListRecord[] = [];
      if (caseNumOriginal.length > 0) {
        const { data, error: caseNumberError } = await supabase
          .from('daily_cause_list')
          .select(CL_SELECT)
          .eq('cause_date', targetDate)
          .eq('court_name', 'Madras High Court')
          .eq('bench', 'Chennai')
          .in('case_number', caseNumOriginal);
        if (caseNumberError) throw caseNumberError;
        if (data) caseNumResultsRaw.push(...(data as DailyCauseListRecord[]));
      }

      const seen = new Set<string>();
      const merged: MatchedRecord[] = [];

      for (const causeListRecord of cnrResultsRaw) {
        if (seen.has(causeListRecord.id)) continue;
        const key = causeListRecord.cnr_number?.trim().toLowerCase();
        const matchedCase = key ? cnrMap.get(key) : undefined;
        if (!matchedCase) continue;
        seen.add(causeListRecord.id);
        merged.push({ causeList: causeListRecord, case: matchedCase, matchType: 'cnr' });
      }

      for (const causeListRecord of caseNumResultsRaw) {
        if (seen.has(causeListRecord.id)) continue;
        const key = causeListRecord.case_number?.trim().toLowerCase();
        const matchedCase = key ? caseNumMap.get(key) : undefined;
        if (!matchedCase) continue;
        seen.add(causeListRecord.id);
        merged.push({ causeList: causeListRecord, case: matchedCase, matchType: 'case_number' });
      }

      setMatchedRecords(merged);
    } catch (err) {
      console.error('[TodaysListingsPage] fetch error:', err);
      setError('Failed to load listings. Please try again.');
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

  const fetchCaseDetails = useCallback(async (record: MatchedRecord, captcha?: string) => {
    setSelectedRecord(record);
    setDetailsDialogOpen(true);
    setDetailsLoading(true);
    setDetailsError(null);
    setCaseDetails(null);

    try {
      const payload: Record<string, string> = {
        cnr_number: normalizeText(record.causeList.cnr_number),
        case_number: normalizeText(record.causeList.case_number),
      };

      if (captcha) payload.captcha = captcha.trim();
      if (captchaToken) payload.captcha_token = captchaToken;

      const response = await fetch('/api/ecourts/case-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      let data: CaseDetailsResponse | null = null;
      try {
        data = (await response.json()) as CaseDetailsResponse;
      } catch {
        data = null;
      }

      if (!response.ok) {
        throw new Error(data?.message || 'Unable to fetch case details.');
      }

      if (data?.requiresCaptcha) {
        setDetailsDialogOpen(false);
        setCaptchaDialogOpen(true);
        setCaptchaValue('');
        setCaptchaImage(data.captchaImage ?? null);
        setCaptchaToken(data.captchaToken ?? null);
        setCaptchaMessage(data.message ?? 'Captcha is required for case number search.');
        setDetailsLoading(false);
        return;
      }

      if (!data?.success) {
        setDetailsError(data?.message || 'Unable to fetch case details.');
        return;
      }

      setCaseDetails(data);
    } catch (err) {
      console.error('[TodaysListingsPage] details fetch error:', err);
      setDetailsError('Unable to fetch case details.');
    } finally {
      setDetailsLoading(false);
    }
  }, [captchaToken]);

  const refreshCaptcha = useCallback(async () => {
    if (!selectedRecord) return;
    setCaptchaSubmitting(true);
    try {
      const response = await fetch('/api/ecourts/case-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cnr_number: '',
          case_number: normalizeText(selectedRecord.causeList.case_number),
        }),
      });
      const data = (await response.json()) as CaseDetailsResponse;
      if (!response.ok) throw new Error(data.message || 'Unable to refresh captcha.');

      setCaptchaImage(data.captchaImage ?? null);
      setCaptchaToken(data.captchaToken ?? null);
      setCaptchaMessage(data.message ?? 'Enter the captcha shown above.');
      setCaptchaValue('');
    } catch (err) {
      console.error('[TodaysListingsPage] captcha refresh error:', err);
      setCaptchaMessage('Unable to refresh captcha. Please try again.');
    } finally {
      setCaptchaSubmitting(false);
    }
  }, [selectedRecord]);

  async function submitCaptcha() {
    if (!selectedRecord || !captchaValue.trim()) return;
    setCaptchaSubmitting(true);
    setCaptchaDialogOpen(false);
    await fetchCaseDetails(selectedRecord, captchaValue.trim());
    setCaptchaSubmitting(false);
  }

  return (
    <>
      <div className="space-y-5 p-6">
        <div>
          <h1 className="text-xl font-semibold">Today's Listings</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Cases listed today in Madras High Court that are being tracked in Litigo.
            {causeDate && !loading && (
              <span className="ml-1">
                · {causeDate === new Date().toISOString().split('T')[0] ? "Today's" : 'Latest available'} cause list:
                {' '}
                <span className="font-medium">{fmtDate(causeDate)}</span>
              </span>
            )}
          </p>
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
            <Button variant="ghost" size="sm" onClick={fetchData}>
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
                    <TableHead className="whitespace-nowrap">CNR Number</TableHead>
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
                    paginated.map((record) => (
                      <TableRow key={record.causeList.id}>
                        <TableCell className="whitespace-nowrap font-medium">{record.causeList.court_hall ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap">{record.causeList.item_number ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">{record.causeList.cnr_number ?? '—'}</TableCell>
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
                          <MatchTypeBadge type={record.matchType} />
                        </TableCell>
                        <TableCell>
                          <Button variant="outline" size="sm" className="h-7 gap-1.5 whitespace-nowrap text-xs" onClick={() => fetchCaseDetails(record)}>
                            <Eye className="h-3.5 w-3.5" />
                            Show Details
                          </Button>
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

      <CaseDetailsDialog
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        loading={detailsLoading}
        error={detailsError}
        details={caseDetails}
      />

      <CaptchaDialog
        open={captchaDialogOpen}
        onOpenChange={setCaptchaDialogOpen}
        image={captchaImage}
        value={captchaValue}
        onChange={setCaptchaValue}
        onSubmit={submitCaptcha}
        onRefresh={refreshCaptcha}
        submitting={captchaSubmitting}
        message={captchaMessage}
      />
    </>
  );
}

import { Card, CardContent } from '@/components/ui/card';
import {
  Scale, ShieldCheck, Landmark, Mail, User,
  Briefcase, CalendarClock, Network, Users, ListTodo,
  Database, Download, GitCompareArrows, Bell, Gavel,
  MessageSquare, Globe,
} from 'lucide-react';
import {
  APP_NAME, APP_VERSION, DEVELOPER_NAME, DEVELOPER_EMAIL,
} from '@/lib/appInfo';

// ── Static content ───────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: Briefcase,
    title: 'Case Management',
    desc: 'Centralised registry of every government case — parties, status, sensitivity, CLA tagging and full hearing history in one place.',
    accent: 'text-blue-600',
    bg: 'bg-blue-50',
    ring: 'ring-blue-100',
  },
  {
    icon: CalendarClock,
    title: 'Cause List Monitoring',
    desc: 'Automated daily ingestion of the Madras High Court cause list with instant matching against your tracked portfolio.',
    accent: 'text-amber-600',
    bg: 'bg-amber-50',
    ring: 'ring-amber-100',
  },
  {
    icon: Network,
    title: 'eCourts Integration',
    desc: 'Live case status, orders and hearing history pulled directly from the national eCourts and MHC judicial services.',
    accent: 'text-emerald-600',
    bg: 'bg-emerald-50',
    ring: 'ring-emerald-100',
  },
  {
    icon: Users,
    title: 'Advocate Management',
    desc: 'Assign advocates, track readiness, counters, documents awaited and compliance across the entire litigation team.',
    accent: 'text-indigo-600',
    bg: 'bg-indigo-50',
    ring: 'ring-indigo-100',
  },
  {
    icon: ListTodo,
    title: 'Task Management',
    desc: 'Create, assign and monitor case tasks with due dates, ownership and overdue escalation for accountability.',
    accent: 'text-rose-600',
    bg: 'bg-rose-50',
    ring: 'ring-rose-100',
  },
  {
    icon: Bell,
    title: 'Smart Alerts',
    desc: 'Timely email and messaging reminders so officers and advocates are always prepared for upcoming hearings.',
    accent: 'text-violet-600',
    bg: 'bg-violet-50',
    ring: 'ring-violet-100',
  },
];

const WORKFLOW = [
  { icon: Download,         title: 'Ingest',  desc: 'Daily cause list pulled from the High Court automatically.' },
  { icon: GitCompareArrows, title: 'Match',   desc: 'Listings matched to your tracked cases by CNR & case number.' },
  { icon: Bell,             title: 'Notify',  desc: 'Advocates and officers alerted to relevant hearings.' },
  { icon: Gavel,            title: 'Hearing', desc: 'Teams prepare with orders, history and task checklists.' },
];

const INTEGRATIONS = [
  { icon: Scale,         name: 'eCourts Services',  detail: 'National judicial data exchange' },
  { icon: Landmark,      name: 'Madras High Court', detail: 'Cause list & order PDFs' },
  { icon: Database,      name: 'Supabase',          detail: 'Secure managed Postgres backend' },
  { icon: Mail,          name: 'Email Alerts',      detail: 'Transactional case notifications' },
  { icon: MessageSquare, name: 'SMS / WhatsApp',    detail: 'Multi-channel hearing reminders' },
  { icon: ShieldCheck,   name: 'Role-based Access', detail: 'Organisation-scoped permissions' },
];

// ── About page ─────────────────────────────────────────────────────────────────

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-10 pb-8">

      {/* ═══ 1. Product Hero ═══════════════════════════════════════════════════ */}
      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 shadow-xl ring-1 ring-white/10">
        <div className="px-6 py-10 sm:px-10 sm:py-14">
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-blue-600 shadow-lg shadow-blue-900/40">
              <Scale className="h-8 w-8 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{APP_NAME}</h1>
                <span className="rounded-full bg-blue-500/20 px-2.5 py-0.5 text-xs font-semibold text-blue-200 ring-1 ring-blue-400/30">
                  {APP_VERSION}
                </span>
              </div>
              <p className="mt-1 text-base font-medium text-blue-100 sm:text-lg">
                Government Litigation Management &amp; Monitoring Platform
              </p>
            </div>
          </div>

          <p className="mt-6 max-w-3xl text-sm leading-relaxed text-blue-100/90 sm:text-base">
            {APP_NAME} is a unified litigation command centre for government departments — tracking court
            cases, daily cause-list listings, hearings, advocate activity and compliance across Tamil Nadu.
            The focus is practical day-to-day legal operations: better visibility, faster preparation and
            fewer missed hearing actions.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {[
              { icon: ShieldCheck, label: 'Secure & Compliant' },
              { icon: Landmark,    label: 'Built for Government' },
              { icon: Network,     label: 'eCourts Connected' },
            ].map(({ icon: Icon, label }) => (
              <span key={label} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white ring-1 ring-white/15">
                <Icon className="h-3.5 w-3.5 text-blue-200" /> {label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 2. Feature Cards ══════════════════════════════════════════════════ */}
      <section>
        <header className="mb-4">
          <h2 className="text-xl font-semibold tracking-tight">Platform Capabilities</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Everything a litigation department needs, from intake to insight.
          </p>
        </header>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, desc, accent, bg, ring }) => (
            <Card key={title} className="group h-full transition-all hover:-translate-y-0.5 hover:shadow-md">
              <CardContent className="p-5">
                <div className={`mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl ${bg} ring-1 ${ring}`}>
                  <Icon className={`h-5 w-5 ${accent}`} />
                </div>
                <h3 className="text-base font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ═══ 3. Workflow Diagram ═══════════════════════════════════════════════ */}
      <section>
        <header className="mb-4">
          <h2 className="text-xl font-semibold tracking-tight">How It Works</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            An automated pipeline from court data to courtroom readiness.
          </p>
        </header>
        <Card>
          <CardContent className="p-6">
            <ol className="relative flex flex-col gap-8 lg:flex-row lg:gap-4">
              {/* connecting line */}
              <div className="absolute left-5 top-0 hidden h-full w-px bg-border lg:left-0 lg:top-5 lg:h-px lg:w-full" />
              {WORKFLOW.map(({ icon: Icon, title, desc }, i) => (
                <li key={title} className="relative flex flex-1 items-start gap-4 lg:flex-col lg:items-center lg:text-center">
                  <div className="z-10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-md shadow-blue-600/20 ring-4 ring-background">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="lg:mt-2">
                    <div className="flex items-center gap-2 lg:justify-center">
                      <span className="text-xs font-semibold uppercase tracking-wide text-blue-600">Step {i + 1}</span>
                    </div>
                    <h3 className="text-sm font-semibold">{title}</h3>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground lg:max-w-[12rem]">{desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </section>

      {/* ═══ 4. Integrations ═══════════════════════════════════════════════════ */}
      <section>
        <header className="mb-4">
          <h2 className="text-xl font-semibold tracking-tight">Integrations &amp; Connectivity</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Connected to the systems government legal teams rely on.
          </p>
        </header>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {INTEGRATIONS.map(({ icon: Icon, name, detail }) => (
            <div key={name} className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-muted/40">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{name}</p>
                <p className="truncate text-xs text-muted-foreground">{detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ 5. Why Teams Use This Tool ════════════════════════════════════════ */}
      <section>
        <header className="mb-4">
          <h2 className="text-xl font-semibold tracking-tight">Why Teams Use This Tool</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Designed for legal teams that need consistency, speed and accountability.
          </p>
        </header>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              title: 'Single Source of Truth',
              desc: 'Keep case records, hearings, orders and ownership in one place across departments and advocates.',
            },
            {
              title: 'Daily Readiness',
              desc: 'Automatically track today\'s listings and prepare officers with complete context before court time.',
            },
            {
              title: 'Operational Discipline',
              desc: 'Assign tasks, set due dates and monitor completion so no legal follow-up is missed.',
            },
          ].map(({ title, desc }) => (
            <Card key={title}>
              <CardContent className="p-5">
                <h3 className="text-base font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ═══ 6. Version Information ════════════════════════════════════════════ */}
      <section>
        <Card className="bg-muted/30">
          <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white">
                <Scale className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold">{APP_NAME} {APP_VERSION}</p>
                <p className="text-xs text-muted-foreground">Government Litigation Management Platform</p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Version</dt>
                <dd className="font-medium">{APP_VERSION}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Edition</dt>
                <dd className="font-medium">Government</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Region</dt>
                <dd className="font-medium">Tamil Nadu</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </section>

      {/* ═══ 7. Developer Information ══════════════════════════════════════════ */}
      <section>
        <Card>
          <CardContent className="space-y-4 p-6">
            <h2 className="text-xl font-semibold tracking-tight">Developer Details</h2>
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <div className="inline-flex items-center gap-2 text-muted-foreground">
                <User className="h-4 w-4 text-blue-600" />
                <span>Developed by <span className="font-semibold text-foreground">{DEVELOPER_NAME}</span></span>
              </div>
              <a
                href={`mailto:${DEVELOPER_EMAIL}`}
                className="inline-flex items-center gap-2 font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
              >
                <Mail className="h-4 w-4" />
                {DEVELOPER_EMAIL}
              </a>
              <a
                href="https://www.tnlegal.com"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
              >
                <Globe className="h-4 w-4" />
                www.tnlegal.com
              </a>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Built and maintained with a focus on practical government litigation workflows,
              reliability and clean user experience.
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

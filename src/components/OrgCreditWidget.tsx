import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Building2, CreditCard, Activity, X } from 'lucide-react';
import { useOrg } from '@/lib/orgContext';
import {
  fetchUsageForOrg, fetchPricing, summarizeUsage, type OrgUsageSummary,
} from '@/lib/organizations';

function fmtMoney(v: number | null | undefined): string {
  return `₹${Number(v ?? 0).toFixed(2)}`;
}

/**
 * Top-right organization + credit widget. Shows the current organization name,
 * plan and remaining credits; clicking opens a panel with organization details,
 * plan, available credits, credits consumed and an API usage summary.
 */
export function OrgCreditWidget() {
  const { org } = useOrg();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<OrgUsageSummary | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);

  useEffect(() => {
    if (!open || !org) return;
    let active = true;
    setLoadingUsage(true);
    Promise.all([fetchUsageForOrg(org.id), fetchPricing()])
      .then(([rows, price]) => {
        if (!active) return;
        setSummary(summarizeUsage(rows, price));
      })
      .finally(() => { if (active) setLoadingUsage(false); });
    return () => { active = false; };
  }, [open, org]);

  if (!org) {
    return (
      <span className="hidden items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 sm:inline-flex">
        <Building2 className="h-3.5 w-3.5" /> No organization
      </span>
    );
  }

  const credits = Number(org.available_credits ?? 0);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-left transition-colors hover:bg-muted"
        title="Organization & credits"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-600/10 text-blue-700">
          <Building2 className="h-4 w-4" />
        </span>
        <span className="hidden min-w-0 leading-tight sm:block">
          <span className="block max-w-[180px] truncate text-xs font-semibold">{org.organization_name}</span>
          <span className="block text-[11px] text-muted-foreground">
            {(org.plan_name ?? 'Trial')} Plan · <span className={credits <= 0 ? 'font-semibold text-red-600' : 'font-semibold text-emerald-600'}>{fmtMoney(credits)} Balance</span>
          </span>
        </span>
      </button>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[95vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-0 shadow-xl focus:outline-none">
            <div className="flex items-center justify-between gap-2 border-b bg-gradient-to-r from-slate-900 via-blue-900 to-slate-900 px-4 py-3 text-white">
              <div className="flex min-w-0 items-center gap-2">
                <Building2 className="h-5 w-5 shrink-0 text-blue-300" />
                <div className="min-w-0">
                  <Dialog.Title className="truncate text-base font-bold">{org.organization_name}</Dialog.Title>
                  <Dialog.Description className="text-[11px] text-blue-200">{(org.plan_name ?? 'Trial')} Plan</Dialog.Description>
                </div>
              </div>
              <Dialog.Close className="rounded-md p-1.5 text-white/80 hover:bg-white/10 hover:text-white" aria-label="Close">
                <X className="h-5 w-5" />
              </Dialog.Close>
            </div>

            <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
              {/* Organization details */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                {org.short_name && <Detail label="Short Name" value={org.short_name} />}
                <Detail label="Plan" value={org.plan_name ?? 'Trial'} />
                {org.contact_person && <Detail label="Contact" value={org.contact_person} />}
                {org.contact_email && <Detail label="Email" value={org.contact_email} />}
              </div>

              {/* Balance */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Metric icon={CreditCard} label="Balance (₹)" value={fmtMoney(credits)} accent={credits <= 0 ? 'text-red-600' : 'text-emerald-600'} />
                <Metric icon={Activity} label="Amount Charged (₹)" value={summary ? fmtMoney(summary.amountCharged) : '…'} />
                <Metric icon={Activity} label="API Calls" value={summary ? summary.apiCalls.toLocaleString('en-IN') : '…'} />
              </div>

              {/* API usage summary */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">API Usage Summary</p>
                {loadingUsage ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">Loading usage…</p>
                ) : !summary || summary.byEndpoint.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">No API usage yet.</p>
                ) : (
                  <div className="overflow-hidden rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40">
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="px-3 py-2 font-medium">Endpoint</th>
                          <th className="px-3 py-2 text-right font-medium">Calls</th>
                          <th className="px-3 py-2 text-right font-medium">Rate Applied</th>
                          <th className="px-3 py-2 text-right font-medium">Amount Charged</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.byEndpoint.map(e => (
                          <tr key={e.endpoint} className="border-b last:border-0">
                            <td className="px-3 py-2 font-mono text-xs">{e.endpoint}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{e.calls}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(e.rate)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(e.amountCharged)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {summary && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Charged this month: {fmtMoney(summary.amountThisMonth)}
                  </p>
                )}
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="truncate font-medium">{value}</p>
    </div>
  );
}

function Metric({ icon: Icon, label, value, accent = 'text-foreground' }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2 text-center">
      <Icon className="mx-auto mb-1 h-4 w-4 text-muted-foreground" />
      <p className={`text-lg font-bold ${accent}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

import { Scale, Mail, User, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  APP_NAME, APP_VERSION, DEVELOPER_NAME, DEVELOPER_EMAIL,
} from '@/lib/appInfo';

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Brand banner */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-4 bg-gradient-to-r from-slate-900 via-blue-900 to-slate-900 px-5 py-6 text-white">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-blue-600 shadow-lg">
            <Scale className="h-6 w-6 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-bold leading-tight">{APP_NAME} {APP_VERSION}</h2>
            <p className="text-sm text-blue-200">Government Litigation Management &amp; Monitoring Platform</p>
          </div>
        </div>
        <CardContent className="pt-5 text-sm text-muted-foreground">
          <p>
            {APP_NAME} is a litigation command centre for government departments — tracking
            court cases, daily cause-list listings, hearings, advocate activity and
            compliance across Tamil Nadu in a single, training-free dashboard.
          </p>
        </CardContent>
      </Card>

      {/* Developer attribution */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="h-4 w-4 text-blue-600" /> About
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-4 py-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <User className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Developed by</p>
              <p className="font-semibold text-foreground">{DEVELOPER_NAME}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-4 py-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Mail className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</p>
              <a
                href={`mailto:${DEVELOPER_EMAIL}`}
                className="font-semibold text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
              >
                {DEVELOPER_EMAIL}
              </a>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

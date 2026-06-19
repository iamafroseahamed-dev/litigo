import { Settings as SettingsIcon, Scale, Mail, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function Settings() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Administration</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Configure organisation preferences, notification providers, and platform integrations.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SettingsIcon className="h-4 w-4" />
            Organisation Settings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Settings and configuration options will appear here.
          </p>
        </CardContent>
      </Card>

      {/* About Litigo */}
      <Card className="border-blue-100">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="h-4 w-4 text-blue-600" />
            About Litigo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600">
              <Scale className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-lg font-bold leading-tight">Litigo</p>
              <p className="text-xs text-muted-foreground">Legal Case Management &amp; Court Intelligence Platform</p>
            </div>
            <Badge variant="outline" className="ml-auto text-xs">v1.0</Badge>
          </div>

          <div className="rounded-md border bg-muted/30 p-4 space-y-3 text-sm">
            <div className="grid grid-cols-[140px_1fr] gap-y-2">
              <span className="text-muted-foreground font-medium">Version</span>
              <span>1.0</span>
              <span className="text-muted-foreground font-medium">Developed by</span>
              <span>Afrose Ahamed</span>
              <span className="text-muted-foreground font-medium">Contact</span>
              <a
                href="mailto:iamafroseahamed@gmail.com"
                className="flex items-center gap-1.5 text-blue-600 hover:underline"
              >
                <Mail className="h-3.5 w-3.5" />
                iamafroseahamed@gmail.com
              </a>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Litigo is a legal case management system designed for law firms and legal departments,
            providing real-time court cause list monitoring, case tracking, and automated
            hearing notifications.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}


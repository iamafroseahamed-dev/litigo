import { BellRing } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Notifications() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Notification Center</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Review and track all case hearing alerts sent to clients and advocates.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BellRing className="h-4 w-4" />
            Notification History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Notification logs and history will appear here. Use the <strong>Notify</strong> button on
            Matched Listings to send case hearing alerts to configured recipients.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

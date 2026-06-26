import { ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export function AccessDenied({
  title = 'Access denied',
  message = 'You do not have permission to access this area.',
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="p-4 sm:p-6">
      <Card className="mx-auto max-w-xl">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-600">
            <ShieldAlert className="h-7 w-7" />
          </span>
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
}

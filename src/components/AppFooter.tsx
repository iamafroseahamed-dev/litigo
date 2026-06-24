import { cn } from '@/lib/utils';
import { APP_NAME, APP_VERSION, DEVELOPER_NAME, DEVELOPER_EMAIL } from '@/lib/appInfo';

/**
 * Small, non-intrusive developer attribution footer.
 *
 * Renders the app version, developer name and contact email. Uses theme-aware
 * tokens so it stays legible in both light and dark surfaces; pass
 * `variant="onDark"` for placement over dark backgrounds (e.g. the Login page).
 */
export function AppFooter({
  className,
  variant = 'default',
}: {
  className?: string;
  variant?: 'default' | 'onDark';
}) {
  const muted = variant === 'onDark' ? 'text-blue-200/60' : 'text-muted-foreground';
  const link = variant === 'onDark'
    ? 'text-blue-200/80 hover:text-blue-100'
    : 'text-muted-foreground hover:text-foreground';

  return (
    <footer className={cn('select-none text-center text-[11px] leading-relaxed', muted, className)}>
      <p className="font-medium">{APP_NAME} {APP_VERSION}</p>
      <p>Developed by {DEVELOPER_NAME}</p>
      <a href={`mailto:${DEVELOPER_EMAIL}`} className={cn('underline-offset-2 transition-colors hover:underline', link)}>
        {DEVELOPER_EMAIL}
      </a>
    </footer>
  );
}

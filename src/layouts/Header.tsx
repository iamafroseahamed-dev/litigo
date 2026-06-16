import { Bell, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';

interface HeaderProps {
  title: string;
  onMenuClick: () => void;
}

export function Header({ title, onMenuClick }: HeaderProps) {
  const { user } = useAuth();

  return (
    <header className="flex items-center justify-between gap-3 border-b bg-white px-3 py-3 sm:px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onMenuClick}
          className="h-10 w-10 lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-foreground sm:text-lg lg:text-xl">{title}</h1>
          <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="relative">
          <Bell className="w-5 h-5 text-muted-foreground cursor-pointer hover:text-foreground" />
        </div>
        <div className="flex items-center gap-2 border-l pl-2 sm:pl-3">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-semibold">
            {user?.profile.full_name.charAt(0).toUpperCase()}
          </div>
          <div className="hidden md:block">
            <p className="text-sm font-medium leading-tight">{user?.profile.full_name}</p>
            <p className="text-xs text-muted-foreground capitalize">{user?.profile.role}</p>
          </div>
        </div>
      </div>
    </header>
  );
}

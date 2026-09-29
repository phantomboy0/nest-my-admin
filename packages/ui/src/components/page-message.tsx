import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function PageMessage({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'error' }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-lg border p-6 text-sm', tone === 'error' ? 'border-destructive/40 text-destructive' : 'text-muted-foreground')}
    >
      {children}
    </div>
  );
}

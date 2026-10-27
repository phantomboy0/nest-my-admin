import type * as React from 'react';
import { cn } from '@/lib/utils';

/** A page's title row: title (with badges after it), a muted subtitle under it, actions at the far end. */
export function PageHeader({ title, subtitle, badges, actions, leading, className }: {
  title: React.ReactNode; subtitle?: React.ReactNode; badges?: React.ReactNode; actions?: React.ReactNode; leading?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start gap-4', className)}>
      {leading}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[22px] leading-tight font-bold">{title}</h1>
          {badges}
        </div>
        {subtitle && <p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

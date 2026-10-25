import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The design's card: 12px radius, 1px border, a faint shadow (none in dark). With a title it gets a header row
 * (title, optional subtitle and icon, actions at the end) separated from the body by a divider.
 */
export function Card({
  title, subtitle, icon, actions, footer, className, bodyClassName, children, ...props
}: Omit<React.ComponentProps<'section'>, 'title'> & {
  title?: React.ReactNode; subtitle?: React.ReactNode; icon?: React.ReactNode; actions?: React.ReactNode;
  footer?: React.ReactNode; bodyClassName?: string;
}) {
  return (
    <section data-slot="card" className={cn('rounded-card border border-border bg-card text-card-foreground shadow-card', className)} {...props}>
      {title !== undefined && (
        <header className="flex min-h-14 items-center gap-2 border-b border-border px-5 py-3">
          {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(title !== undefined && 'p-5', bodyClassName)}>{children}</div>
      {footer && <footer className="border-t border-border px-5 py-3">{footer}</footer>}
    </section>
  );
}

import type * as React from 'react';
import type { Tone } from '@nest-my-admin/core/contract';
import { cn } from '@/lib/utils';

const TONE: Record<Tone, string> = {
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  bad: 'bg-bad-bg text-bad',
  info: 'bg-info-bg text-info',
  neutral: 'bg-muted text-muted-foreground',
  primary: 'bg-primary-soft text-primary-text',
};

/** The design's status pill: 22px high, fully rounded, 12px medium text. */
export function Badge({ tone = 'neutral', className, ...props }: React.ComponentProps<'span'> & { tone?: Tone }) {
  return (
    <span
      data-slot="badge"
      data-tone={tone}
      className={cn('inline-flex h-[22px] items-center gap-1 rounded-full px-2 text-xs leading-none font-medium whitespace-nowrap', TONE[tone], className)}
      {...props}
    />
  );
}

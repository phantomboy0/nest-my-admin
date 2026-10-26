import { ArrowDown, ArrowUp } from 'lucide-react';
import type { StatWidgetData } from '@nest-my-admin/core/contract';
import { formatNumberText } from '@/i18n';
import { changeModel } from '@/lib/dashboard';
import { cn } from '@/lib/utils';

/** A number with its unit, and its change against the previous period (green up, red down). */
export function StatWidget({ title, data }: { title: string; data: StatWidgetData }) {
  const change = changeModel(data.change);
  return (
    <div className="flex flex-col gap-2 px-5 py-[18px]">
      <div className="text-[13px] font-medium text-muted-foreground">{title}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[26px] leading-[1.3] font-bold">{formatNumberText(data.value)}</span>
        {data.unit && <span className="text-[13px] text-muted-foreground">{data.unit}</span>}
      </div>
      {(change || data.previousLabel) && (
        <div className="flex items-center gap-2 text-xs">
          {change && (
            <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium', change.tone === 'ok' ? 'bg-ok-bg text-ok' : change.tone === 'bad' ? 'bg-bad-bg text-bad' : 'bg-muted text-muted-foreground')}>
              {change.arrow === 'up' && <ArrowUp className="size-3" aria-hidden />}
              {change.arrow === 'down' && <ArrowDown className="size-3" aria-hidden />}
              {formatNumberText(change.text)}
            </span>
          )}
          {data.previousLabel && <span className="text-muted-foreground">{data.previousLabel}</span>}
        </div>
      )}
    </div>
  );
}

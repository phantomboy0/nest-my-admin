import type { ProgressWidgetData } from '@nest-my-admin/core/contract';
import { formatNumberText } from '@/i18n';

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** A ring with the percent, the title and a caption (the month's sales goal). */
export function ProgressWidget({ title, data }: { title: string; data: ProgressWidgetData }) {
  const percent = Math.max(0, Math.min(100, data.percent));
  return (
    <div className="flex items-center gap-5 p-5">
      <svg viewBox="0 0 100 100" role="img" aria-label={formatNumberText(data.value)} className="size-[104px] shrink-0 -rotate-90">
        <circle cx="50" cy="50" r={RADIUS} fill="none" strokeWidth={10} className="stroke-muted" />
        <circle cx="50" cy="50" r={RADIUS} fill="none" strokeWidth={10} strokeLinecap="round" strokeDasharray={`${(percent / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`} className="stroke-primary" />
      </svg>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="text-2xl leading-tight font-bold">{formatNumberText(data.value)}</div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-[13px] text-muted-foreground">{data.caption}</p>
      </div>
    </div>
  );
}

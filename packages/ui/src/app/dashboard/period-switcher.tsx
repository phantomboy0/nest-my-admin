import { useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { Popover } from 'radix-ui';
import type { WidgetParams } from '@nest-my-admin/core/contract';
import { DateInput } from '@/app/date-input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tabs } from '@/components/ui/tabs';
import { useT } from '@/i18n';

export type Period = WidgetParams['period'];

/** The dashboard's one period control: today, week, month, year, or a chosen range of days (in the chosen calendar). */
export function PeriodSwitcher({ period, from, to, onChange }: { period: Period; from?: string; to?: string; onChange: (period: Period, from?: string, to?: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(from ?? '');
  const [end, setEnd] = useState(to ?? '');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs
        className="w-auto"
        items={(['day', 'week', 'month', 'year'] as const).map((key) => ({ key, label: t(`dashboard.${key}`) }))}
        value={period === 'range' ? '' : period}
        onChange={(key) => onChange(key as Period)}
      />
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button variant={period === 'range' ? 'secondary' : 'outline'} size="icon" aria-label={t('dashboard.range')} aria-pressed={period === 'range'}>
            <CalendarRange />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="end" sideOffset={6} className="z-50 flex w-72 flex-col gap-3 rounded-[10px] border bg-popover p-3 shadow-lg">
            <div className="flex flex-col gap-1">
              <Label htmlFor="dashboard-from">{t('filters.from')}</Label>
              <DateInput id="dashboard-from" label={t('filters.from')} value={start} onChange={setStart} live />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="dashboard-to">{t('filters.to')}</Label>
              <DateInput id="dashboard-to" label={t('filters.to')} value={end} onChange={setEnd} live />
            </div>
            <Button
              disabled={!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end}
              onClick={() => {
                setOpen(false);
                onChange('range', start, end);
              }}
            >
              {t('dashboard.apply')}
            </Button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

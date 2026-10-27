import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { DashboardResponse, WidgetData, WidgetParams } from '@nest-my-admin/core/contract';
import { ChartWidget } from '@/app/dashboard/chart-widget';
import { ListWidget } from '@/app/dashboard/list-widget';
import { PeriodSwitcher, type Period } from '@/app/dashboard/period-switcher';
import { ProgressWidget } from '@/app/dashboard/progress-widget';
import { StatWidget } from '@/app/dashboard/stat-widget';
import { TableWidget } from '@/app/dashboard/table-widget';
import { PageMessage } from '@/components/page-message';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/i18n';
import { api, describeError } from '@/lib/api';
import { periodRange } from '@/lib/dashboard';
import { cn } from '@/lib/utils';

const PERIODS: Period[] = ['day', 'week', 'month', 'year', 'range'];
/** Columns of the 12-column grid: stats sit four to a row; other widgets by `size` (the design's 8 + 4). */
const SPAN = { 1: 'lg:col-span-4', 2: 'lg:col-span-6', 3: 'lg:col-span-8', 4: 'lg:col-span-12' } as const;

/** The dashboard (spec §5.8): the period in the URL, then each widget the user may see, loading on its own. */
export function DashboardPage() {
  const { t, calendar } = useLocale();
  const [search, setSearch] = useSearchParams();
  const asked = search.get('period') as Period | null;
  const period: Period = asked && PERIODS.includes(asked) ? asked : 'week';
  const from = search.get('from') ?? undefined;
  const to = search.get('to') ?? undefined;
  const params = periodRange(period, new Date(), calendar === 'persian' ? 'persian' : 'gregory', from, to);
  const layout = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[22px] font-bold">{t('dashboard.title')}</h1>
          <p className="text-[13px] text-muted-foreground">{t('dashboard.subtitle')}</p>
        </div>
        <div className="ms-auto">
          <PeriodSwitcher
            period={period}
            from={from}
            to={to}
            onChange={(next, start, end) => setSearch(next === 'range' ? { period: next, from: start!, to: end! } : next === 'week' ? {} : { period: next })}
          />
        </div>
      </div>
      {layout.isPending && <PageMessage>{t('common.loading')}</PageMessage>}
      {layout.isError && <PageMessage tone="error">{describeError(layout.error)}</PageMessage>}
      {layout.data && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {layout.data.widgets.map((widget) => (
            <Widget key={widget.name} widget={widget} params={params} />
          ))}
        </div>
      )}
    </div>
  );
}

function Widget({ widget, params }: { widget: DashboardResponse['widgets'][number]; params: WidgetParams }) {
  const { t } = useLocale();
  // Each widget is its own query: a period change refetches them all; one failing leaves the others.
  const data = useQuery({ queryKey: ['dashboard', widget.name, params], queryFn: () => api.widget(widget.name, params), retry: false });
  const span = widget.type === 'stat' ? 'lg:col-span-3' : SPAN[widget.size];
  return (
    <section aria-label={widget.title} data-widget={widget.name} className={cn('min-w-0 overflow-hidden rounded-card border bg-card shadow-card', span)}>
      {data.isPending && (
        <div aria-hidden className="flex flex-col gap-3 p-5">
          <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
          <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      )}
      {data.isError && (
        <div role="alert" className="flex flex-col items-start gap-2 p-5 text-[13px]">
          <span className="font-semibold">{widget.title}</span>
          <span className="text-muted-foreground">{t('dashboard.failed')}</span>
          <Button size="sm" variant="outline" onClick={() => void data.refetch()}>
            {t('dashboard.retry')}
          </Button>
        </div>
      )}
      {data.data && <WidgetBody type={widget.type} title={widget.title} data={data.data} />}
    </section>
  );
}

function WidgetBody({ type, title, data }: { type: DashboardResponse['widgets'][number]['type']; title: string; data: WidgetData }) {
  switch (type) {
    case 'stat':
      return <StatWidget title={title} data={data as never} />;
    case 'chart':
      return <ChartWidget title={title} data={data as never} />;
    case 'table':
      return <TableWidget title={title} data={data as never} />;
    case 'progress':
      return <ProgressWidget title={title} data={data as never} />;
    case 'list':
      return <ListWidget title={title} data={data as never} />;
  }
}

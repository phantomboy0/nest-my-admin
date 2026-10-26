import type { ChartWidgetData } from '@nest-my-admin/core/contract';
import { formatNumber, useT } from '@/i18n';
import { chartGeometry } from '@/lib/dashboard';

const WIDTH = 600;
const HEIGHT = 200;

/** A bar or line chart drawn as SVG: one or two series, the second dashed («previous period»), gridlines and labels. */
export function ChartWidget({ title, data }: { title: string; data: ChartWidgetData }) {
  const t = useT();
  const geometry = chartGeometry(data, WIDTH, HEIGHT);
  // Up to six labels under the chart, evenly picked.
  const step = Math.max(1, Math.ceil(data.labels.length / 6));
  return (
    <div className="flex flex-col gap-3.5 p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {data.subtitle && <p className="text-[13px] text-muted-foreground">{data.subtitle}</p>}
        </div>
        <div className="ms-auto flex gap-4 text-xs text-muted-foreground">
          {data.series.map((series) => (
            <span key={series.label} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={series.dashed ? 'h-0 w-3.5 border-t-2 border-dashed border-muted-foreground' : 'h-[3px] w-3.5 rounded-sm bg-primary'} />
              {series.label}
            </span>
          ))}
        </div>
      </div>
      {/* Time runs with the reading direction: mirrored in RTL, like the labels under it. */}
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={title} className="h-[230px] w-full overflow-visible rtl:-scale-x-100">
        <g className="stroke-border">
          {geometry.gridlines.map((line) => (
            <path key={line.y} d={`M0 ${line.y}H${WIDTH}`} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
        {geometry.series.map((series, index) =>
          data.kind === 'bar' && !series.dashed ? (
            <g key={series.label} className="fill-primary">
              {series.bars.map((bar, bar_index) => (
                <rect key={bar_index} x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx={3} />
              ))}
            </g>
          ) : (
            <g key={series.label}>
            {/* The current period's line has its area shaded, as drawn. */}
            {!series.dashed && index === 0 && <path d={`${series.path} L${WIDTH} ${HEIGHT} L0 ${HEIGHT} Z`} className="fill-primary/10" />}
            <path
              d={series.path}
              fill="none"
              vectorEffect="non-scaling-stroke"
              strokeWidth={series.dashed ? 2 : 2.5}
              strokeDasharray={series.dashed ? '5 5' : undefined}
              className={series.dashed || index > 0 ? 'stroke-muted-foreground' : 'stroke-primary'}
            />
            </g>
          ),
        )}
      </svg>
      <div aria-hidden className="flex justify-between text-[11.5px] text-muted-foreground">
        {data.labels.filter((_, index) => index % step === 0).map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <span className="sr-only">
        {data.series.map((series) => `${series.label}: ${series.values.map((value) => formatNumber(value)).join(', ')}`).join('; ')} {t('dashboard.period')}
      </span>
    </div>
  );
}

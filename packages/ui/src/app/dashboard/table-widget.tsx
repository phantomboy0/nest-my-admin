import { Link } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import type { TableWidgetData } from '@nest-my-admin/core/contract';
import { Badge } from '@/components/ui/badge';
import { formatNumber, formatNumberText, useT } from '@/i18n';

/** Rows with a status badge column, and «View all» to the list with the widget's filter. */
export function TableWidget({ title, data }: { title: string; data: TableWidgetData }) {
  const t = useT();
  const href = data.link ? `/${data.link.resource}${data.link.filter ? `?${new URLSearchParams(data.link.filter)}` : ''}` : undefined;
  return (
    <div className="flex flex-col">
      <div className="flex min-h-14 items-center gap-2 border-b px-5 py-3">
        <h2 className="flex-1 text-[15px] font-semibold">{title}</h2>
        {href && (
          <Link to={href} className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
            {t('dashboard.viewAll')}
            <ChevronLeft className="size-3.5 ltr:rotate-180" aria-hidden />
          </Link>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-[color-mix(in_oklab,var(--muted)_50%,transparent)] text-[12.5px] text-muted-foreground">
            <tr>
              {data.columns.map((column) => (
                <th key={column.key} className="px-3.5 py-2.5 text-start font-medium whitespace-nowrap">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, index) => (
              <tr key={index} className="border-t">
                {data.columns.map((column) => {
                  const value = row[column.key];
                  return (
                    <td key={column.key} className="px-3.5 py-2.5 whitespace-nowrap">
                      {value !== null && typeof value === 'object' ? <Badge tone={value.tone}>{value.label}</Badge> : typeof value === 'number' ? formatNumber(value) : formatNumberText(String(value ?? ''))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { Link } from 'react-router';
import type { ListWidgetData } from '@nest-my-admin/core/contract';
import { iconFor } from '@/lib/icons';
import { cn } from '@/lib/utils';

const DOT = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', info: 'bg-info', neutral: 'bg-muted-foreground', primary: 'bg-primary' } as const;

/** Items with an icon, a status dot and a link. */
export function ListWidget({ title, data }: { title: string; data: ListWidgetData }) {
  return (
    <div className="flex flex-col gap-3 p-5">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <ul className="flex flex-col gap-2.5">
        {data.items.map((item, index) => {
          const Icon = iconFor(item.icon, 'resource');
          const body = (
            <>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-muted text-muted-foreground">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 text-[13px]">{item.text}</span>
              {item.status && <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DOT[item.status])} />}
            </>
          );
          return (
            <li key={index}>
              {item.link ? (
                <Link to={item.link} className="flex items-center gap-3 rounded-control hover:bg-muted">
                  {body}
                </Link>
              ) : (
                <div className="flex items-center gap-3">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

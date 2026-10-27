import { cn } from '@/lib/utils';

export interface TabItem { key: string; label: React.ReactNode; count?: React.ReactNode; estimate?: boolean }

/** The design's underlined tabs: 38px, muted text, the current one bold with a 2px underline in the text colour. */
export function Tabs({ items, value, onChange, className }: { items: TabItem[]; value: string; onChange: (key: string) => void; className?: string }) {
  return (
    <div role="tablist" className={cn('flex w-full gap-0.5 border-b border-border', className)}>
      {items.map((item) => {
        const on = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(item.key)}
            className={cn(
              '-mb-px inline-flex h-[38px] cursor-pointer items-center gap-1.5 border-b-2 border-transparent px-3 text-[13px] text-muted-foreground',
              on && 'border-foreground font-semibold text-foreground',
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">
                {item.estimate ? '~' : ''}{item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

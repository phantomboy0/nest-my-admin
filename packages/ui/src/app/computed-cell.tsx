import { useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminRecord, ComputedColumnSchema, ComputedValue, ListResponse, ResourceSchema } from '@nest-my-admin/core/contract';
import { Badge } from '@/components/ui/badge';
import { useT } from '@/i18n';
import { api, describeError } from '@/lib/api';
import { cellModel } from '@/lib/computed-cells';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

interface ComputedCellProps {
  schema: ResourceSchema;
  name: string;
  column: ComputedColumnSchema;
  item: AdminRecord;
  /** Phone cards: a smaller image, and the title without its own line break. */
  compact?: boolean;
}

/**
 * A computed list cell (spec §5.4): a 40×40 image (a placeholder when empty), a title over a muted mono subline, money
 * with its unit and the struck earlier price, a status badge, a muted count, or a switch that writes its enum field.
 */
export function ComputedCell({ schema, name, column, item, compact = false }: ComputedCellProps) {
  const cell = (item._computed as Record<string, ComputedValue> | undefined)?.[name];
  const model = cellModel(column, cell);
  switch (model.kind) {
    case 'image':
      return (
        <span className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-control border bg-muted text-muted-foreground', compact ? 'size-14' : 'size-10')}>
          {model.src ? <img src={model.src} alt="" className="size-full object-cover" loading="lazy" /> : <ImageIcon className="size-[18px]" aria-hidden />}
        </span>
      );
    case 'title':
      return (
        <span className="flex min-w-0 flex-col leading-[1.45]">
          <span className={cn('truncate font-semibold', compact ? 'text-[14.5px]' : 'text-[13.5px]')}>{model.text}</span>
          {model.subline && (
            // The line follows the page's direction; the SKU itself reads left to right.
            <span className="truncate text-start font-mono text-[11.5px] text-muted-foreground">
              <bdi dir="ltr">{model.subline}</bdi>
            </span>
          )}
        </span>
      );
    case 'money':
      return (
        <span className="flex flex-col leading-[1.4]">
          <span className="font-semibold whitespace-nowrap">
            {model.unit && model.unitPosition === 'before' && <span className="text-xs font-normal text-muted-foreground">{model.unit} </span>}
            {model.text}
            {model.unit && model.unitPosition !== 'before' && <span className="text-xs font-normal text-muted-foreground"> {model.unit}</span>}
          </span>
          {model.previous && <s className="text-xs text-muted-foreground">{model.previous}</s>}
        </span>
      );
    case 'badge':
      return <Badge tone={model.tone}>{model.text}</Badge>;
    case 'count':
      return <span className="text-muted-foreground">{model.text}</span>;
    case 'toggle':
      return <ToggleCell schema={schema} column={column} item={item} on={model.on === true} />;
  }
}

/** The switch of a `toggle` column: a PATCH of its enum field with `on` or `off`, then the row is replaced in place. */
function ToggleCell({ schema, column, item, on }: { schema: ResourceSchema; column: ComputedColumnSchema; item: AdminRecord; on: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [shown, setShown] = useState(on);
  const toggle = column.toggle;
  const allowed = toggle !== undefined && (item._perm as { update?: boolean } | undefined)?.update !== false && !(Array.isArray(item._readonly) && item._readonly.includes(toggle.field));
  const save = useMutation({
    mutationFn: (next: boolean) => api.update(schema.name, String(item._id), { [toggle!.field]: next ? toggle!.on : toggle!.off }, schema.version ? item[schema.version] : undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['list', schema.name] }),
    onError: (error) => {
      setShown(on);
      toast(describeError(error), 'error');
    },
  });
  const title = typeof item._title === 'string' ? item._title : String(item._id);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={shown}
      aria-label={t('list.toggleRow', { column: column.label, name: title })}
      disabled={!allowed || save.isPending}
      onClick={(event) => {
        // Phone cards are links: the switch must not open the record.
        event.preventDefault();
        event.stopPropagation();
        setShown(!shown);
        save.mutate(!shown);
      }}
      className={cn(
        'relative inline-block h-5 w-9 shrink-0 cursor-pointer rounded-full bg-input transition-colors disabled:cursor-default disabled:opacity-60',
        shown && 'bg-primary',
        "after:absolute after:top-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition-[inset-inline-start] after:content-[''] after:start-0.5",
        shown && 'after:start-[18px]',
      )}
    />
  );
}

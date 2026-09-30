import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { ArrowDown, ArrowUp, Check, Columns3 } from 'lucide-react';
import { Checkbox, Popover } from 'radix-ui';
import type { ResourceSchema } from '@nest-my-admin/core/contract';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { columnStore, orderedColumns, type ColumnPrefs, type Density } from '@/lib/column-prefs';
import { cn } from '@/lib/utils';

/** Show, hide and reorder the list's columns, and pick the row density; remembered per resource. */
export function ColumnMenu({ schema, prefs }: { schema: ResourceSchema; prefs: ColumnPrefs }) {
  const t = useT();
  const all = orderedColumns(schema.list.columns, prefs);
  const label = (name: string) => schema.fields.find((field) => field.name === name)?.label ?? name;
  const visible = all.filter((name) => !prefs.hidden.includes(name));
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="outline" className="hidden md:inline-flex">
          <Columns3 />
          {t('list.columns')}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={4} className="z-50 flex w-72 flex-col gap-3 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md">
          <ul aria-label={t('list.columns')} className="flex flex-col gap-0.5">
            {all.map((name, index) => {
              const shown = !prefs.hidden.includes(name);
              return (
                <li key={name} className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-accent">
                  <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
                    <Checkbox.Root
                      checked={shown}
                      disabled={shown && visible.length === 1} // keep at least one column
                      onCheckedChange={() => columnStore.toggle(schema.name, name)}
                      className="flex size-4 items-center justify-center rounded border border-input disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
                    >
                      <Checkbox.Indicator>
                        <Check className="size-3" />
                      </Checkbox.Indicator>
                    </Checkbox.Root>
                    {label(name)}
                  </label>
                  <Button variant="ghost" size="icon-sm" aria-label={t('list.moveUp', { name: label(name) })} disabled={index === 0} onClick={() => columnStore.move(schema.name, schema.list.columns, name, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={t('list.moveDown', { name: label(name) })} disabled={index === all.length - 1} onClick={() => columnStore.move(schema.name, schema.list.columns, name, 1)}>
                    <ArrowDown />
                  </Button>
                </li>
              );
            })}
          </ul>
          <div role="radiogroup" aria-label={t('list.density')} className="flex gap-1">
            {(['comfortable', 'compact'] as Density[]).map((density) => (
              <Button
                key={density}
                role="radio"
                aria-checked={prefs.density === density}
                variant={prefs.density === density ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => columnStore.setDensity(schema.name, density)}
              >
                {t(density === 'compact' ? 'list.compact' : 'list.comfortable')}
              </Button>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="self-start" onClick={() => columnStore.reset(schema.name)}>
            {t('list.resetColumns')}
          </Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Drag (or arrow keys, ±10 px) to resize a column; the width is remembered. */
export function ResizeHandle({ resource, column, label, width }: { resource: string; column: string; label: string; width: number | undefined }) {
  const t = useT();
  const start = useRef<{ x: number; width: number; rtl: boolean } | null>(null);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const cell = event.currentTarget.parentElement!;
    start.current = { x: event.clientX, width: cell.getBoundingClientRect().width, rtl: getComputedStyle(cell).direction === 'rtl' };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const delta = (event.clientX - start.current.x) * (start.current.rtl ? -1 : 1);
    columnStore.setWidth(resource, column, start.current.width + delta);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const current = width ?? event.currentTarget.parentElement!.getBoundingClientRect().width;
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const wider = (event.key === 'ArrowRight') !== rtl;
    columnStore.setWidth(resource, column, current + (wider ? 10 : -10));
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('list.resize', { name: label })}
      aria-valuenow={width}
      tabIndex={0}
      className={cn('absolute inset-y-1 end-0 w-1.5 cursor-col-resize touch-none rounded bg-transparent hover:bg-border focus-visible:bg-ring')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (start.current = null)}
      onKeyDown={onKeyDown}
      onClick={(event) => event.stopPropagation()}
    />
  );
}

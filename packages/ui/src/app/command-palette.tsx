import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/i18n';
import { api } from '@/lib/api';
import { navigationItems, type PaletteItem } from '@/lib/palette';
import { useMeta } from '@/lib/queries';
import { cn } from '@/lib/utils';

/** Waits until `value` has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * ⌘K / Ctrl+K (spec §9.1): go to a resource or group, open a "New …" form, or find records across every searchable
 * resource (`/api/search`, which goes through each resource's own `findMany`). A combobox with a listbox: arrows move,
 * Enter opens, Escape closes and focus goes back where it was.
 */
export function CommandPalette() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const meta = useMeta();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const term = useDebounced(query.trim(), 250);
  const searching = term.length >= 2 && (meta.data?.groups.some((group) => group.resources.some((resource) => resource.searchable)) ?? false);
  const records = useQuery({ queryKey: ['search', term], queryFn: () => api.search(term), enabled: open && searching, staleTime: 10_000 });

  const items: PaletteItem[] = [
    ...(meta.data ? navigationItems(meta.data, query, (name) => t('palette.new', { name })) : []),
    ...(searching && query.trim() === term
      ? (records.data?.groups ?? []).flatMap((group) =>
          group.items.map((item) => ({
            id: `record:${group.resource}:${item._id}`,
            section: 'records' as const,
            label: item._title,
            detail: group.label,
            to: `/${group.resource}/${encodeURIComponent(item._id)}`,
          })),
        )
      : []),
  ];
  const current = Math.min(active, Math.max(0, items.length - 1));

  useEffect(() => setActive(0), [query, records.data]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  function go(item: PaletteItem | undefined) {
    if (!item) return;
    setOpen(false);
    navigate(item.to);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (items.length === 0) return;
      setActive((current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(items[current]);
    }
  }

  const sections: Array<[PaletteItem['section'], string]> = [
    ['go', t('palette.goTo')],
    ['create', t('palette.create')],
    ['records', t('palette.records')],
  ];
  const optionId = (index: number) => `${listId}-${index}`;
  const status = searching && (records.isFetching || query.trim() !== term) ? t('palette.searching') : items.length === 0 ? t('palette.noResults') : '';

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <Dialog.Trigger asChild>
        <Button variant="outline" size="sm" className="gap-2 text-muted-foreground" aria-keyshortcuts="Control+K Meta+K" aria-label={t('palette.open')}>
          <Search />
          <span className="hidden lg:inline">{t('palette.open')}</span>
          <kbd className="hidden rounded border bg-muted px-1 font-sans text-[0.7rem] lg:inline">⌘K</kbd>
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-3 top-[12vh] z-50 mx-auto flex max-h-[70vh] max-w-xl flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl outline-none"
        >
          <Dialog.Title className="sr-only">{t('palette.open')}</Dialog.Title>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 text-muted-foreground" aria-hidden />
            <input
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={items.length > 0 ? optionId(current) : undefined}
              aria-label={t('palette.open')}
              placeholder={t('palette.placeholder')}
              className="h-12 flex-1 bg-transparent text-sm outline-none"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
          <ul ref={listRef} id={listId} role="listbox" aria-label={t('palette.results')} className="flex-1 overflow-y-auto p-1">
            {sections.map(([section, title]) => {
              const entries = items.map((item, index) => ({ item, index })).filter(({ item }) => item.section === section);
              if (entries.length === 0) return null;
              return (
                <li key={section} role="presentation">
                  <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground" aria-hidden>
                    {title}
                  </div>
                  <ul role="group" aria-label={title}>
                    {entries.map(({ item, index }) => (
                      <li
                        key={item.id}
                        id={optionId(index)}
                        role="option"
                        aria-selected={index === current}
                        data-index={index}
                        className={cn('flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-2 text-sm', index === current && 'bg-accent text-accent-foreground')}
                        onMouseMove={() => setActive(index)}
                        onClick={() => go(item)}
                      >
                        <span className="truncate">{item.label}</span>
                        {item.detail && <span className="shrink-0 text-xs text-muted-foreground">{item.detail}</span>}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
          <p role="status" className={cn('px-3 text-sm text-muted-foreground', status && 'border-t py-2')}>
            {status}
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

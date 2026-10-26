import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Moon, Plus, Search } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/i18n';
import { api } from '@/lib/api';
import { matches, navigationItems, type PaletteItem } from '@/lib/palette';
import { flipTheme } from '@/lib/theme';
import { iconFor } from '@/lib/icons';
import { navGroups } from '@/lib/menu';
import { useMeta, useSession } from '@/lib/queries';
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
  const session = useSession();
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

  // A record's icon is its resource's, else its section's.
  const iconOf = (resource: string) => {
    const group = meta.data ? navGroups(meta.data).find((candidate) => candidate.resources.some((entry) => entry.name === resource)) : undefined;
    return group?.resources.find((entry) => entry.name === resource)?.icon ?? group?.icon;
  };
  const navigation = meta.data ? navigationItems(meta.data, query, (name) => t('palette.new', { name }), [{ id: 'theme', label: t('palette.toggleTheme') }]) : [];
  // The design's order: records, actions, then places to go.
  const items: PaletteItem[] = [
    ...(searching && query.trim() === term
      ? (records.data?.groups ?? []).flatMap((group) =>
          group.items.map((item) => ({
            id: `record:${group.resource}:${item._id}`,
            section: 'records' as const,
            ...(iconOf(group.resource) ? { icon: iconOf(group.resource) } : {}),
            label: item._title,
            detail: group.label,
            to: `/${group.resource}/${encodeURIComponent(item._id)}`,
          })),
        )
      : []),
    ...navigation.filter((item) => item.section === 'actions'),
    ...navigation.filter((item) => item.section === 'go'),
    // The audit page (also the way to it in an admin without sign-in, which has no user menu).
    ...(session.data?.audit.view && matches(t('audit.title'), query) ? [{ id: 'audit', section: 'go' as const, label: t('audit.title'), to: '/-/audit' }] : []),
  ];
  const current = Math.min(active, Math.max(0, items.length - 1));

  useEffect(() => setActive(0), [query, records.data]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  function go(item: PaletteItem | undefined) {
    if (!item) return;
    setOpen(false);
    if (item.to) navigate(item.to);
    else if (item.id === 'theme') flipTheme();
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
    ['records', t('palette.records')],
    ['actions', t('palette.actions')],
    ['go', t('palette.goTo')],
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
        <Button variant="outline" className="w-9 justify-start px-0 font-normal text-muted-foreground max-sm:justify-center sm:w-[260px] sm:px-3.5" aria-keyshortcuts="Control+K Meta+K" aria-label={t('palette.open')}>
          <Search />
          <span className="hidden truncate sm:inline">{t('palette.placeholder')}</span>
          <kbd className="ms-auto hidden rounded-[5px] border border-border bg-muted px-[5px] py-px font-mono text-[11px] text-muted-foreground sm:inline" dir="ltr">⌘K</kbd>
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-3 top-[12vh] z-50 mx-auto flex max-h-[70vh] max-w-[540px] flex-col overflow-hidden rounded-card border border-border bg-card text-card-foreground shadow-[0_24px_48px_rgba(0,0,0,.18)] outline-none"
        >
          <Dialog.Title className="sr-only">{t('palette.open')}</Dialog.Title>
          <div className="flex items-center gap-2.5 border-b border-border px-4">
            <Search className="size-4 text-muted-foreground" aria-hidden />
            <input
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={items.length > 0 ? optionId(current) : undefined}
              aria-label={t('palette.open')}
              placeholder={t('palette.placeholder')}
              className="h-[52px] flex-1 bg-transparent text-sm outline-none"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <kbd className="rounded-[5px] border border-border bg-muted px-[5px] py-px font-mono text-[11px] text-muted-foreground" dir="ltr">Esc</kbd>
          </div>
          <ul ref={listRef} id={listId} role="listbox" aria-label={t('palette.results')} className="flex-1 overflow-y-auto p-1.5">
            {sections.map(([section, title]) => {
              const entries = items.map((item, index) => ({ item, index })).filter(({ item }) => item.section === section);
              if (entries.length === 0) return null;
              return (
                <li key={section} role="presentation">
                  <div className="px-2.5 pt-2.5 pb-1 text-xs font-medium text-muted-foreground" aria-hidden>
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
                        className={cn('flex h-10 cursor-pointer items-center gap-3 rounded-control px-2.5 text-[13.5px]', index === current && 'bg-muted')}
                        onMouseMove={() => setActive(index)}
                        onClick={() => go(item)}
                      >
                        <PaletteIcon item={item} />
                        {/* Places read «Section › Item», as in the design; records keep their resource at the end. */}
                        <span className="flex-1 truncate">{item.section === 'go' && item.detail ? `${item.detail} › ${item.label}` : item.label}</span>
                        {item.section === 'records' && item.detail && <span className="shrink-0 text-xs text-muted-foreground">{item.detail}</span>}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
          <p role="status" className={cn('px-4 text-sm text-muted-foreground', status && 'border-t border-border py-2')}>
            {status}
          </p>
          <div className="flex items-center gap-4 border-t border-border px-4 py-2.5 text-xs text-muted-foreground" aria-hidden>
            <span className="flex items-center gap-1.5"><kbd className="rounded-[5px] border border-border bg-muted px-[5px] font-mono text-[11px]">↑↓</kbd>{t('palette.move')}</span>
            <span className="flex items-center gap-1.5"><kbd className="rounded-[5px] border border-border bg-muted px-[5px] font-mono text-[11px]">↵</kbd>{t('palette.openItem')}</span>
            <span className="ms-auto flex items-center gap-1.5"><kbd className="rounded-[5px] border border-border bg-muted px-[5px] font-mono text-[11px]" dir="ltr">⌘K</kbd>{t('palette.close')}</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The design's leading icon: + for create, the moon for the theme, else the item's own (resource or section). */
function PaletteIcon({ item }: { item: PaletteItem }) {
  const Icon = item.id.startsWith('new:') ? Plus : item.id === 'theme' ? Moon : iconFor(item.icon, item.section === 'records' ? 'resource' : 'group');
  return <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { OVERLAY_ANIMATED_CLASS } from '@/components/ui/overlay';
import { ArrowDownUp, Check, ChevronDown, CirclePlus, ListFilter, Search, SlidersHorizontal, X } from 'lucide-react';
import { Checkbox, Dialog, Popover } from 'radix-ui';
import type { FieldSchema, FilterOperator, ResourceSchema } from '@nest-my-admin/core/contract';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RelationInput } from '@/app/relation-input';
import { formatNumber, useLocale, useT } from '@/i18n';
import { filterChips, type FilterChip } from '@/lib/filter-chips';
import { DateInput } from '@/app/date-input';
import { toLatinNumber } from '@/lib/digits';
import { toDatetimeLocal } from '@/lib/form-values';
import { useRelationRefs } from '@/lib/queries';
import { activeFilterCount, clearFilters, filterKey, hasActiveFilters, restoreFilters, type ParamChanges } from '@/lib/list-state';
import { useIsMobile } from '@/lib/use-media';
import { cn } from '@/lib/utils';
import { enumLabel } from '@/lib/widgets';

interface FilterBarProps {
  schema: ResourceSchema;
  params: URLSearchParams;
  onChange: (changes: ParamChanges) => void;
  /** Desktop: controls at the end of the filter row (the column menu). */
  trailing?: ReactNode;
}

export const selectClass =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';
const RANGE_TYPES = new Set(['number', 'decimal', 'bigint', 'date', 'datetime']);

export function FilterBar({ schema, params, onChange, trailing }: FilterBarProps) {
  const t = useT();
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<URLSearchParams>();
  const urlSearch = params.get('search') ?? '';
  const [search, setSearch] = useState(urlSearch);
  useEffect(() => {
    setSearch(urlSearch);
  }, [urlSearch]);

  const filters = schema.list.filters
    .map((filter) => ({ operators: filter.operators, field: schema.fields.find((field) => field.name === filter.field) }))
    .filter((entry): entry is { operators: FilterOperator[]; field: FieldSchema } => entry.field !== undefined);
  const searchable = schema.list.search.length > 0;
  // Phones sort in the drawer (there are no column headers).
  const drawer = mobile && (filters.length > 0 || schema.list.sortable.length > 0);
  if (filters.length === 0 && !searchable && !drawer && !trailing) return null;
  const searchLabels = schema.list.search.map((name) => schema.fields.find((field) => field.name === name)?.label ?? name);

  if (!mobile) {
    const chips = new Map(filterChips(schema, params).map((chip) => [chip.key, chip]));
    return (
      <div className="flex flex-wrap items-center gap-2">
        {searchable && (
          <SearchBox label={t('filters.search')} placeholder={t('filters.searchIn', { fields: searchLabels.join(', ') })} value={search} onChange={setSearch} onSubmit={() => onChange({ search: search.trim() || null })} />
        )}
        {/* One list in schema order: a chip that moved when set would remount and close its popover mid-choice. */}
        {filters.length > 0 && (
          <ul aria-label={t('filters.filters')} className="contents">
            {filters.map(({ field, operators }) => (
              <li key={field.name} className="contents">
                <FilterChipButton resource={schema.name} field={field} operators={operators} params={params} onChange={onChange} chip={chips.get(`filter:${field.name}`)} />
              </li>
            ))}
          </ul>
        )}
        {hasActiveFilters(params) && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(clearFilters(params))}>
            {t('filters.clear')}
            <X className="size-3.5" />
          </Button>
        )}
        {trailing && <div className="ms-auto flex items-center gap-2">{trailing}</div>}
      </div>
    );
  }

  const count = activeFilterCount(params);
  // A tab's own filters are the tab: they make no chips (lib/filter-chips.ts).
  const hasChips = filterChips(schema, params).length > 0;
  const sortLabel = sortChoiceLabel(schema, params, t);
  const openDrawer = () => {
    setSnapshot(new URLSearchParams(params));
    setOpen(true);
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex gap-2">
        {searchable && (
          <SearchBox
            className="flex-1"
            label={t('filters.search')}
            placeholder={t('filters.searchIn', { fields: searchLabels.join(', ') })}
            value={search}
            onChange={setSearch}
            onSubmit={() => onChange({ search: search.trim() || null })}
          />
        )}
        {drawer && (
          <Button type="button" variant="outline" aria-haspopup="dialog" onClick={openDrawer}>
            <SlidersHorizontal />
            {t('filters.filters')}
            {count > 0 && (
              // Hidden from screen readers: the active filters are listed under the bar.
              <span aria-hidden className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                {formatNumber(count)}
              </span>
            )}
          </Button>
        )}
      </div>
      {(hasChips || (drawer && sortLabel)) && (
        <div className="flex flex-wrap items-center gap-2">
          {hasChips && <FilterChips schema={schema} params={params} onChange={onChange} />}
          {drawer && sortLabel && (
            <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-input bg-card px-3 text-[13px]" aria-haspopup="dialog" onClick={openDrawer}>
              <ArrowDownUp className="size-3.5 text-muted-foreground" aria-hidden />
              {sortLabel}
            </button>
          )}
        </div>
      )}
      {drawer && (
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className={OVERLAY_ANIMATED_CLASS} />
            <Dialog.Content
              aria-describedby={undefined}
              className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-[18px] bg-card shadow-xl outline-none"
            >
              <div className="flex justify-center pt-2" aria-hidden>
                <span className="h-1.5 w-10 rounded-full bg-input" />
              </div>
              <div className="flex items-center gap-2 ps-4 pe-2 pt-1.5 pb-2">
                <Dialog.Title className="flex-1 text-[17px] font-bold">{t('filters.filtersAndSort')}</Dialog.Title>
                {hasActiveFilters(params) && (
                  <Button type="button" variant="ghost" className="text-primary" onClick={() => onChange(clearFilters(params))}>
                    {t('filters.clear')}
                  </Button>
                )}
              </div>
              <div className="flex flex-col gap-5 overflow-y-auto px-4 py-1">
                {filters.map(({ field, operators }) => (
                  <FilterControl key={field.name} resource={schema.name} field={field} operators={operators} params={params} onChange={onChange} touch />
                ))}
                {schema.list.sortable.length > 0 && <SortSelect schema={schema} params={params} onChange={onChange} />}
              </div>
              <div className="flex gap-2.5 border-t px-4 pt-3 pb-5">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (snapshot) onChange(restoreFilters(params, snapshot));
                    setOpen(false);
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Dialog.Close asChild>
                  <Button className="flex-1">{t('filters.showResults')}</Button>
                </Dialog.Close>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </div>
  );
}

/** The current sort as the phone's sort chip names it ('' when the list has no sortable field). */
function sortChoiceLabel(schema: ResourceSchema, params: URLSearchParams, t: ReturnType<typeof useT>): string {
  if (schema.list.sortable.length === 0) return '';
  const { field: defaultField, direction } = schema.list.defaultSort;
  const current = params.get('sort') ?? (direction === 'desc' ? `-${defaultField}` : defaultField);
  const name = current.replace(/^-/, '');
  const label = schema.fields.find((field) => field.name === name)?.label ?? name;
  return t(current.startsWith('-') ? 'filters.descending' : 'filters.ascending', { name: label });
}

/** Sort on phones: one choice per sortable field and direction (the URL's `sort`, like the column headers). */
function SortSelect({ schema, params, onChange }: FilterBarProps) {
  const t = useT();
  const { field: defaultField, direction } = schema.list.defaultSort;
  const current = params.get('sort') ?? (direction === 'desc' ? `-${defaultField}` : defaultField);
  const label = (name: string) => schema.fields.find((field) => field.name === name)?.label ?? name;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="list-sort">{t('filters.sortBy')}</Label>
      <select id="list-sort" className={selectClass} value={current} onChange={(event) => onChange({ sort: event.target.value, page: null, after: null })}>
        {schema.list.sortable.flatMap((name) => [
          <option key={name} value={name}>
            {t('filters.ascending', { name: label(name) })}
          </option>,
          <option key={`-${name}`} value={`-${name}`}>
            {t('filters.descending', { name: label(name) })}
          </option>,
        ])}
      </select>
    </div>
  );
}

interface FilterControlProps {
  /** Inside a chip's popover: enum choices are listed in place, not behind another popover. */
  inline?: boolean;
  /** In the phone drawer: enum choices as pills, short single choices as a segmented control. */
  touch?: boolean;
  resource: string;
  field: FieldSchema;
  operators: FilterOperator[];
  params: URLSearchParams;
  onChange: (changes: ParamChanges) => void;
}

/** The field's main control, plus an empty / not-empty choice for nullable fields. */
function FilterControl(props: FilterControlProps) {
  const main = <MainFilterControl {...props} />;
  const { field, operators, params, onChange } = props;
  // Relation filters clear to "no filter" already; for others, empty values are a separate question.
  if (!field.nullable || !operators.includes('isNull') || field.type === 'relation') return main;
  return (
    <div className="flex flex-col gap-1.5">
      {main}
      <NullFilter field={field} params={params} onChange={onChange} />
    </div>
  );
}

function NullFilter({ field, params, onChange }: Pick<FilterControlProps, 'field' | 'params' | 'onChange'>) {
  const t = useT();
  const key = filterKey(field.name, 'isNull');
  return (
    <select
      aria-label={t('filters.emptyValues', { field: field.label })}
      className={cn(selectClass, 'h-7 text-xs text-muted-foreground')}
      value={params.get(key) ?? ''}
      onChange={(event) => onChange({ [key]: event.target.value || null })}
    >
      <option value="">{t('filters.any')}</option>
      <option value="true">{t('filters.onlyEmpty')}</option>
      <option value="false">{t('filters.hideEmpty')}</option>
    </select>
  );
}

/** Pick any number of enum values (`in`). */
function MultiSelectFilter({ id, inline, field, params, onChange }: { id: string } & Pick<FilterControlProps, 'inline' | 'field' | 'params' | 'onChange'>) {
  const t = useT();
  const key = filterKey(field.name, 'in');
  const selected = (params.get(key) ?? '').split(',').filter(Boolean);
  const toggle = (value: string) => {
    const next = selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value];
    onChange({ [key]: next.length > 0 ? next.join(',') : null });
  };
  if (inline) return <EnumChoices field={field} selected={selected} onToggle={toggle} />;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{field.label}</Label>
      <Popover.Root>
        <Popover.Trigger asChild>
          <Button id={id} type="button" variant="outline" className="justify-between font-normal">
            <span className="truncate">{selected.length === 0 ? t('common.all') : selected.length <= 2 ? selected.map((value) => enumLabel(field, value)).join(', ') : t('filters.selected', { count: selected.length })}</span>
            <ChevronDown className="size-4 opacity-60" aria-hidden />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="start" sideOffset={4} className="z-50 min-w-48 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
            <EnumChoices field={field} selected={selected} onToggle={toggle} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

function EnumChoices({ field, selected, onToggle }: { field: FieldSchema; selected: string[]; onToggle: (value: string) => void }) {
  return (
    <ul aria-label={field.label}>
      {(field.enumValues ?? []).map((value) => (
        <li key={value}>
          <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
            <Checkbox.Root
              checked={selected.includes(value)}
              onCheckedChange={() => onToggle(value)}
              className="flex size-4 items-center justify-center rounded border border-input data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
            >
              <Checkbox.Indicator>
                <Check className="size-3" />
              </Checkbox.Indicator>
            </Checkbox.Root>
            {enumLabel(field, value)}
          </label>
        </li>
      ))}
    </ul>
  );
}

function MainFilterControl({ inline, touch, resource, field, operators, params, onChange }: FilterControlProps) {
  const { t, calendar } = useLocale();
  const id = `filter-${field.name}`;

  if (touch && field.type === 'enum' && operators.includes('in')) return <EnumPills field={field} params={params} onChange={onChange} />;
  if (field.type === 'enum' && operators.includes('in')) return <MultiSelectFilter id={id} inline={inline} field={field} params={params} onChange={onChange} />;

  if (field.type === 'relation') {
    const operator: FilterOperator = field.relation?.kind === 'to-many' ? 'in' : 'eq';
    if (!operators.includes(operator)) return null;
    return <RelationFilter id={id} resource={resource} field={field} operator={operator} params={params} onChange={onChange} />;
  }

  if ((field.type === 'enum' || field.type === 'boolean') && operators.includes('eq')) {
    const key = filterKey(field.name, 'eq');
    const options: Array<[string, string]> =
      field.type === 'boolean' ? [['true', t('common.yes')], ['false', t('common.no')]] : (field.enumValues ?? []).map((value) => [value, enumLabel(field, value)]);
    if (touch && options.length <= 3) return <Segmented label={field.label} options={[['', t('common.all')], ...options]} value={params.get(key) ?? ''} onChange={(value) => onChange({ [key]: value || null })} />;
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{field.label}</Label>
        <select id={id} className={selectClass} value={params.get(key) ?? ''} onChange={(event) => onChange({ [key]: event.target.value || null })}>
          <option value="">{t('common.all')}</option>
          {options.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if ((field.type === 'date' || field.type === 'datetime') && operators.includes('gte') && operators.includes('lte')) {
    // Dates, and datetimes as whole local days (the same picker in both calendars): from the start of the first day to the end of the last (spec §12).
    const toUrl = (operator: 'gte' | 'lte', value: string) =>
      field.type === 'date' || !value ? value : new Date(`${value}T${operator === 'gte' ? '00:00:00.000' : '23:59:59.999'}`).toISOString();
    const fromUrl = (value: string | null) => (value && field.type === 'datetime' ? toDatetimeLocal(value).slice(0, 10) : (value ?? ''));
    return (
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">{field.label}</legend>
        <div className="flex flex-wrap gap-2">
          {(['gte', 'lte'] as const).map((operator) => {
            const key = filterKey(field.name, operator);
            const inputId = `${id}-${operator}`;
            const label = t(operator === 'gte' ? 'filters.from' : 'filters.to');
            return (
              <div key={operator} className="flex min-w-36 flex-1 flex-col gap-1">
                <Label htmlFor={inputId} className="text-xs text-muted-foreground">
                  {label}
                </Label>
                <DateInput id={inputId} label={`${field.label} ${label}`} value={fromUrl(params.get(key))} onChange={(value) => onChange({ [key]: toUrl(operator, value) || null })} />
              </div>
            );
          })}
        </div>
      </fieldset>
    );
  }

  if (RANGE_TYPES.has(field.type) && operators.includes('gte') && operators.includes('lte')) {
    const inputType = field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : 'text';
    const toUrl = (value: string) => (field.type === 'datetime' && value ? new Date(value).toISOString() : toLatinNumber(value.trim()).replace(/,/g, ''));
    const fromUrl = (value: string | null) => (value && field.type === 'datetime' ? toDatetimeLocal(value) : (value ?? ''));
    return (
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">{field.label}</legend>
        <div className="flex gap-2">
          {(['gte', 'lte'] as const).map((operator) => {
            const key = filterKey(field.name, operator);
            const inputId = `${id}-${operator}`;
            return (
              <div key={operator} className="flex flex-1 flex-col gap-1">
                <Label htmlFor={inputId} className="text-xs text-muted-foreground">
                  {t(operator === 'gte' ? 'filters.from' : 'filters.to')}
                </Label>
                <CommitInput
                  id={inputId}
                  type={inputType}
                  inputMode={inputType === 'text' ? 'decimal' : undefined}
                  value={fromUrl(params.get(key))}
                  onCommit={(value) => onChange({ [key]: toUrl(value) || null })}
                />
              </div>
            );
          })}
        </div>
      </fieldset>
    );
  }

  const operator: FilterOperator | undefined = operators.includes('contains') ? 'contains' : operators.includes('eq') ? 'eq' : undefined;
  if (!operator) return null;
  const key = filterKey(field.name, operator);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{operator === 'contains' ? t('filters.contains', { field: field.label }) : field.label}</Label>
      <CommitInput id={id} value={params.get(key) ?? ''} onCommit={(value) => onChange({ [key]: value.trim() || null })} />
    </div>
  );
}

/** The active filters as removable chips (spec §9.2); relation chips show titles. */
function FilterChips({ schema, params, onChange }: FilterBarProps) {
  const t = useT();
  const chips = filterChips(schema, params);
  return (
    <ul aria-label={t('filters.active')} className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <li key={chip.key} className="inline-flex h-9 items-center gap-1 rounded-full border border-primary bg-primary-soft ps-3 pe-1.5 text-[13px] font-semibold text-primary">
          <span className="font-medium">{chip.label}:</span>
          {chip.ref ? <RefTitles resource={schema.name} chip={chip} /> : <span>{chip.value}</span>}
          <button
            type="button"
            className="rounded-full p-1 hover:bg-primary-soft"
            aria-label={t('filters.removeChip', { label: chip.label })}
            onClick={() => onChange(Object.fromEntries(chip.remove.map((key) => [key, null])))}
          >
            <X className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function RefTitles({ resource, chip }: { resource: string; chip: FilterChip }) {
  const refs = useRelationRefs(resource, chip.ref!.field, chip.ref!.ids);
  if (!refs.data) return <span>{chip.value}</span>;
  const titles = new Map(refs.data.items.map((ref) => [String(ref.id), ref.title]));
  return <span>{chip.ref!.prefix + chip.ref!.ids.map((id) => titles.get(id) ?? `#${id}`).join(', ')}</span>;
}

interface RelationFilterProps {
  id: string;
  resource: string;
  field: FieldSchema;
  operator: FilterOperator;
  params: URLSearchParams;
  onChange: (changes: ParamChanges) => void;
}

/** Picks related records; the URL keeps only their ids, so titles are looked up when the page is opened from a link. */
function RelationFilter({ id, resource, field, operator, params, onChange }: RelationFilterProps) {
  const key = filterKey(field.name, operator);
  const ids = (params.get(key) ?? '').split(',').filter(Boolean);
  const refs = useRelationRefs(resource, field.name, ids);
  const known = new Map((refs.data?.items ?? []).map((ref) => [String(ref.id), ref]));
  const value = ids.map((knownId) => known.get(knownId) ?? { id: knownId, title: `#${knownId}` });
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{field.label}</Label>
      <RelationInput
        id={id}
        resource={resource}
        field={field}
        clearable
        value={operator === 'in' ? value : (value[0] ?? null)}
        onChange={(next) => {
          const picked = Array.isArray(next) ? next : next ? [next] : [];
          onChange({ [key]: picked.length > 0 ? picked.map((ref) => ref.id).join(',') : null });
        }}
      />
    </div>
  );
}

interface CommitInputProps {
  id: string;
  value: string;
  type?: string;
  inputMode?: 'decimal';
  onCommit: (value: string) => void;
}

/** A text input that applies its value on Enter or blur, not on every keystroke. */
function CommitInput({ id, value, type = 'text', inputMode, onCommit }: CommitInputProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <Input
      id={id}
      type={type}
      inputMode={inputMode}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}

interface SearchBoxProps {
  label: string;
  placeholder: string;
  value: string;
  className?: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

/** The list search: applied on Enter. */
function SearchBox({ label, placeholder, value, className, onChange, onSubmit }: SearchBoxProps) {
  return (
    <form
      role="search"
      className={cn('relative w-[300px] max-w-full', className)}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input aria-label={label} placeholder={placeholder} value={value} className="ps-8" onChange={(event) => onChange(event.target.value)} />
    </form>
  );
}

/** One filter on the desktop row: a dashed chip that opens the field's control; when set, solid with its value. */
function FilterChipButton({ chip, ...props }: FilterControlProps & { chip?: FilterChip }) {
  const t = useT();
  const { field, onChange } = props;
  const remove = chip && (() => onChange(Object.fromEntries(chip.remove.map((key) => [key, null]))));
  return (
    <Popover.Root>
      <span className={cn('inline-flex h-8 items-center rounded-lg border border-dashed border-input', chip && 'border-solid bg-card')}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="inline-flex h-full items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {chip ? <ListFilter className="size-3.5 text-muted-foreground" aria-hidden /> : <CirclePlus className="size-3.5 text-muted-foreground" aria-hidden />}
            {field.label}
            {chip && (
              <>
                <span className="sr-only">:</span>
                <span className="h-4 w-px bg-border" aria-hidden />
                <span className="max-w-48 truncate rounded-[5px] bg-muted px-1.5 text-xs font-medium">
                  {chip.ref ? <RefTitles resource={props.resource} chip={chip} /> : chip.value}
                </span>
              </>
            )}
          </button>
        </Popover.Trigger>
        {remove && (
          <button type="button" className="-ms-1 me-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t('filters.removeChip', { label: field.label })} onClick={remove}>
            <X className="size-3.5" />
          </button>
        )}
      </span>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          // A focused relation input opens its options and shows its value as a placeholder: let the user focus it.
          onOpenAutoFocus={field.type === 'relation' ? (event) => event.preventDefault() : undefined}
          className="z-50 flex w-72 flex-col gap-3 rounded-[10px] border bg-popover p-3 text-popover-foreground shadow-lg outline-none">
          <FilterControl {...props} inline />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const pillClass =
  'inline-flex h-9 items-center gap-1.5 rounded-full border border-input bg-card px-3 text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=checked]:border-primary data-[state=checked]:bg-primary-soft data-[state=checked]:font-semibold data-[state=checked]:text-primary';

/** Phone drawer: an enum's `in` filter as toggle pills. */
function EnumPills({ field, params, onChange }: Pick<FilterControlProps, 'field' | 'params' | 'onChange'>) {
  const key = filterKey(field.name, 'in');
  const selected = (params.get(key) ?? '').split(',').filter(Boolean);
  const toggle = (value: string) => {
    const next = selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value];
    onChange({ [key]: next.length > 0 ? next.join(',') : null });
  };
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-sm font-medium" aria-hidden>
        {field.label}
      </span>
      <ul aria-label={field.label} className="flex flex-wrap gap-2">
        {(field.enumValues ?? []).map((value) => (
          <li key={value}>
            <Checkbox.Root checked={selected.includes(value)} onCheckedChange={() => toggle(value)} className={pillClass}>
              <Checkbox.Indicator>
                <Check className="size-3.5" />
              </Checkbox.Indicator>
              {enumLabel(field, value)}
            </Checkbox.Root>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Phone drawer: one choice out of a few, as a segmented control. */
function Segmented({ label, options, value, onChange }: { label: string; options: Array<[string, string]>; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-sm font-medium" aria-hidden>
        {label}
      </span>
      <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-[10px] bg-muted p-[3px]">
        {options.map(([option, text]) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            className={cn('h-9 rounded-lg text-[13px] text-muted-foreground', value === option && 'bg-card font-semibold text-foreground shadow-sm')}
            onClick={() => onChange(option)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

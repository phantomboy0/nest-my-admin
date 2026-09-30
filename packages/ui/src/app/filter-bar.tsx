import { useEffect, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { Checkbox, Popover } from 'radix-ui';
import type { FieldSchema, FilterOperator, ResourceSchema } from '@nest-my-admin/core/contract';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RelationInput } from '@/app/relation-input';
import { useLocale, useT } from '@/i18n';
import { filterChips, type FilterChip } from '@/lib/filter-chips';
import { DateInput } from '@/app/date-input';
import { toLatinNumber } from '@/lib/digits';
import { toDatetimeLocal } from '@/lib/form-values';
import { useRelationRefs } from '@/lib/queries';
import { clearFilters, filterKey, hasActiveFilters, type ParamChanges } from '@/lib/list-state';
import { cn } from '@/lib/utils';
import { enumLabel } from '@/lib/widgets';

interface FilterBarProps {
  schema: ResourceSchema;
  params: URLSearchParams;
  onChange: (changes: ParamChanges) => void;
}

const selectClass =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';
const RANGE_TYPES = new Set(['number', 'decimal', 'bigint', 'date', 'datetime']);

export function FilterBar({ schema, params, onChange }: FilterBarProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const urlSearch = params.get('search') ?? '';
  const [search, setSearch] = useState(urlSearch);
  useEffect(() => {
    setSearch(urlSearch);
  }, [urlSearch]);

  const filters = schema.list.filters
    .map((filter) => ({ operators: filter.operators, field: schema.fields.find((field) => field.name === filter.field) }))
    .filter((entry): entry is { operators: FilterOperator[]; field: FieldSchema } => entry.field !== undefined);
  const searchable = schema.list.search.length > 0;
  if (filters.length === 0 && !searchable) return null;
  const searchLabels = schema.list.search.map((name) => schema.fields.find((field) => field.name === name)?.label ?? name);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex gap-2">
        {searchable && (
          <form
            role="search"
            className="flex flex-1 gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              onChange({ search: search.trim() || null });
            }}
          >
            <Input aria-label={t('filters.search')} placeholder={t('filters.searchIn', { fields: searchLabels.join(', ') })} value={search} onChange={(event) => setSearch(event.target.value)} />
            <Button type="submit" variant="outline">
              {t('filters.search')}
            </Button>
          </form>
        )}
        {filters.length > 0 && (
          <Button type="button" variant="outline" className="md:hidden" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {t('filters.filters')}
          </Button>
        )}
      </div>
      {filters.length > 0 && (
        <div className={cn('gap-3 sm:grid-cols-2 lg:grid-cols-4', open ? 'grid' : 'hidden md:grid')}>
          {filters.map(({ field, operators }) => (
            <FilterControl key={field.name} resource={schema.name} field={field} operators={operators} params={params} onChange={onChange} />
          ))}
        </div>
      )}
      {hasActiveFilters(params) && (
        <div className="flex flex-wrap items-center gap-2">
          <FilterChips schema={schema} params={params} onChange={onChange} />
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(clearFilters(params))}>
            {t('filters.clear')}
          </Button>
        </div>
      )}
    </div>
  );
}

interface FilterControlProps {
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
function MultiSelectFilter({ id, field, params, onChange }: { id: string } & Pick<FilterControlProps, 'field' | 'params' | 'onChange'>) {
  const t = useT();
  const key = filterKey(field.name, 'in');
  const selected = (params.get(key) ?? '').split(',').filter(Boolean);
  const toggle = (value: string) => {
    const next = selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value];
    onChange({ [key]: next.length > 0 ? next.join(',') : null });
  };
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
            <ul aria-label={field.label}>
              {(field.enumValues ?? []).map((value) => (
                <li key={value}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                    <Checkbox.Root
                      checked={selected.includes(value)}
                      onCheckedChange={() => toggle(value)}
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
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

function MainFilterControl({ resource, field, operators, params, onChange }: FilterControlProps) {
  const { t, calendar } = useLocale();
  const id = `filter-${field.name}`;

  if (field.type === 'enum' && operators.includes('in')) return <MultiSelectFilter id={id} field={field} params={params} onChange={onChange} />;

  if (field.type === 'relation') {
    const operator: FilterOperator = field.relation?.kind === 'to-many' ? 'in' : 'eq';
    if (!operators.includes(operator)) return null;
    return <RelationFilter id={id} resource={resource} field={field} operator={operator} params={params} onChange={onChange} />;
  }

  if ((field.type === 'enum' || field.type === 'boolean') && operators.includes('eq')) {
    const key = filterKey(field.name, 'eq');
    const options: Array<[string, string]> =
      field.type === 'boolean' ? [['true', t('common.yes')], ['false', t('common.no')]] : (field.enumValues ?? []).map((value) => [value, enumLabel(field, value)]);
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

  if ((field.type === 'date' || (field.type === 'datetime' && calendar === 'persian')) && operators.includes('gte') && operators.includes('lte')) {
    // Dates, and Jalali datetimes as whole local days: from the start of the first day to the end of the last (spec §12).
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
    <ul aria-label={t('filters.active')} className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <li key={chip.key} className="inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 ps-2.5 pe-1 text-xs">
          <span className="font-medium">{chip.label}:</span>
          {chip.ref ? <RefTitles resource={schema.name} chip={chip} /> : <span>{chip.value}</span>}
          <button
            type="button"
            className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t('filters.removeChip', { label: chip.label })}
            onClick={() => onChange(Object.fromEntries(chip.remove.map((key) => [key, null])))}
          >
            <X className="size-3" />
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

import { useEffect, useState, type KeyboardEvent } from 'react';
import type { FieldSchema, FilterOperator, ResourceSchema } from '@nest-my-admin/core/contract';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toDatetimeLocal } from '@/lib/form-values';
import { clearFilters, filterKey, hasActiveFilters, type ParamChanges } from '@/lib/list-state';
import { cn } from '@/lib/utils';

interface FilterBarProps {
  schema: ResourceSchema;
  params: URLSearchParams;
  onChange: (changes: ParamChanges) => void;
}

const selectClass =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';
const RANGE_TYPES = new Set(['number', 'decimal', 'bigint', 'date', 'datetime']);

export function FilterBar({ schema, params, onChange }: FilterBarProps) {
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
            <Input aria-label="Search" placeholder={`Search ${searchLabels.join(', ').toLowerCase()}`} value={search} onChange={(event) => setSearch(event.target.value)} />
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
        )}
        {filters.length > 0 && (
          <Button type="button" variant="outline" className="md:hidden" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            Filters
          </Button>
        )}
      </div>
      {filters.length > 0 && (
        <div className={cn('gap-3 sm:grid-cols-2 lg:grid-cols-4', open ? 'grid' : 'hidden md:grid')}>
          {filters.map(({ field, operators }) => (
            <FilterControl key={field.name} field={field} operators={operators} params={params} onChange={onChange} />
          ))}
        </div>
      )}
      {hasActiveFilters(params) && (
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(clearFilters(params))}>
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}

interface FilterControlProps {
  field: FieldSchema;
  operators: FilterOperator[];
  params: URLSearchParams;
  onChange: (changes: ParamChanges) => void;
}

function FilterControl({ field, operators, params, onChange }: FilterControlProps) {
  const id = `filter-${field.name}`;

  if ((field.type === 'enum' || field.type === 'boolean') && operators.includes('eq')) {
    const key = filterKey(field.name, 'eq');
    const options: Array<[string, string]> =
      field.type === 'boolean' ? [['true', 'Yes'], ['false', 'No']] : (field.enumValues ?? []).map((value) => [value, value]);
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{field.label}</Label>
        <select id={id} className={selectClass} value={params.get(key) ?? ''} onChange={(event) => onChange({ [key]: event.target.value || null })}>
          <option value="">All</option>
          {options.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (RANGE_TYPES.has(field.type) && operators.includes('gte') && operators.includes('lte')) {
    const inputType = field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : 'text';
    const toUrl = (value: string) => (field.type === 'datetime' && value ? new Date(value).toISOString() : value.trim());
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
                  {operator === 'gte' ? 'From' : 'To'}
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
      <Label htmlFor={id}>{operator === 'contains' ? `${field.label} contains` : field.label}</Label>
      <CommitInput id={id} value={params.get(key) ?? ''} onCommit={(value) => onChange({ [key]: value.trim() || null })} />
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

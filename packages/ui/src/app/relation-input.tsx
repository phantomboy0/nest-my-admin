import { useEffect, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import type { FieldSchema, RelationRef } from '@nest-my-admin/core/contract';
import { Input } from '@/components/ui/input';
import { describeError } from '@/lib/api';
import { useOptions } from '@/lib/queries';
import { cn } from '@/lib/utils';

export type RelationValue = RelationRef | null | RelationRef[];

interface RelationInputProps {
  id: string;
  /** The resource the field belongs to (options come from its field endpoint). */
  resource: string;
  field: FieldSchema;
  value: RelationValue;
  onChange: (value: RelationValue) => void;
  /** Show a clear button for a picked record (nullable fields and filters). */
  clearable?: boolean;
  invalid?: boolean;
  describedBy?: string;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

const sameId = (a: RelationRef, b: RelationRef) => String(a.id) === String(b.id);

/**
 * Picks related records by typing: an ARIA combobox whose listbox shows the field's options (searched on the
 * server). One record for to-one relations; chips plus the search box for to-many relations.
 */
export function RelationInput({ id, resource, field, value, onChange, clearable, invalid, describedBy }: RelationInputProps) {
  const multiple = field.relation?.kind === 'to-many';
  const selected = multiple && Array.isArray(value) ? value : [];
  const single = !multiple && value && !Array.isArray(value) ? value : null;
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const search = useDebounced(text.trim(), 250);
  const options = useOptions(resource, field.name, search, open);
  const items = (options.data?.items ?? []).filter((item) => !selected.some((picked) => sameId(picked, item)));
  const listId = `${id}-options`;
  const optionId = (index: number) => `${id}-option-${index}`;

  useEffect(() => {
    setActive(0);
  }, [search, options.data]);

  /** Picking closes the list (typing opens it again), so it never hides the controls below it. */
  function choose(item: RelationRef) {
    setText('');
    setOpen(false);
    onChange(multiple ? [...selected, item] : item);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActive((index) => Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
    } else if (event.key === 'Enter' && open) {
      event.preventDefault(); // never submit the form from the picker
      if (items[active]) choose(items[active]);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      setText('');
    } else if (event.key === 'Backspace' && multiple && text === '' && selected.length > 0) {
      onChange(selected.slice(0, -1));
    }
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      {multiple && selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`Selected ${field.label.toLowerCase()}`}>
          {selected.map((ref) => (
            <li key={String(ref.id)} className="inline-flex items-center gap-1 rounded-md bg-muted py-0.5 ps-2 pe-1 text-sm">
              {ref.title}
              <button
                type="button"
                className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${ref.title}`}
                onClick={() => onChange(selected.filter((picked) => !sameId(picked, ref)))}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <Input
          id={id}
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && items[active] ? optionId(active) : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(single && clearable && 'pe-8')}
          placeholder={single ? single.title : multiple ? 'Type to add…' : 'Type to search…'}
          value={open || text ? text : (single?.title ?? '')}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setText('');
          }}
          onKeyDown={onKeyDown}
        />
        {single && clearable && (
          <button
            type="button"
            className="absolute inset-y-0 end-0 flex items-center px-2 text-muted-foreground hover:text-foreground"
            aria-label={`Clear ${field.label}`}
            onClick={() => onChange(null)}
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
          <ul id={listId} role="listbox" aria-label={field.label}>
            {items.map((item, index) => (
              <li
                key={String(item.id)}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                className={cn('cursor-pointer rounded-md px-2 py-1.5 text-sm', index === active && 'bg-accent text-accent-foreground')}
                onMouseDown={(event) => event.preventDefault()} // keep focus in the input so blur does not close first
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(item)}
              >
                {item.title}
              </li>
            ))}
          </ul>
          {items.length === 0 && (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              {options.isError ? describeError(options.error) : options.isFetching || options.isPending ? 'Searching…' : 'No matches'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

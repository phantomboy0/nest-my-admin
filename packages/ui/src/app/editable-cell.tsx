import { useState, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminRecord, FieldSchema, ListResponse, ResourceSchema } from '@nest-my-admin/core/contract';
import { useT } from '@/i18n';
import { ApiError, api } from '@/lib/api';
import { DateInput } from '@/app/date-input';
import { DisplayValue } from '@/app/widgets/badge';
import { formatCell } from '@/lib/format';
import { toFormValues, toPayload } from '@/lib/form-values';
import { validatePayload } from '@/lib/validate';
import { cn } from '@/lib/utils';
import { enumLabel } from '@/lib/widgets';

interface EditableCellProps {
  schema: ResourceSchema;
  item: AdminRecord;
  field: FieldSchema;
}

const inputClass =
  'h-7 w-full min-w-20 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:border-destructive';

/**
 * A list cell edited in place (`list.editable`): click or Enter to edit, Enter or leaving the field to save (a normal
 * PATCH, with `If-Match` when the resource has versions), Escape to cancel. A refused save keeps the old value and
 * shows why under the cell; a saved one updates the row where it is.
 */
export function EditableCell({ schema, item, field }: EditableCellProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const initial = toFormValues([field], item)[field.name] as string | boolean;
  const [draft, setDraft] = useState<string | boolean>(initial);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.update(schema.name, String(item._id), payload, schema.version ? item[schema.version] : undefined),
    onSuccess: (updated) => {
      // Replace the row in every cached page of this list, without refetching.
      queryClient.setQueriesData<ListResponse>({ queryKey: ['list', schema.name] }, (page) =>
        page ? { ...page, items: page.items.map((row) => (row._id === updated._id ? { ...row, ...updated } : row)) } : page,
      );
      queryClient.removeQueries({ queryKey: ['record', schema.name, String(item._id)] });
      setEditing(false);
      setError(null);
    },
    onError: (failure) => {
      setError(failure instanceof ApiError ? (failure.fields[field.name]?.join(' ') ?? failure.message) : failure.message);
      setDraft(initial);
      setEditing(false); // back to the stored value, with the reason under it
    },
  });

  function commit(value: string | boolean = draft) {
    if (value === initial) {
      setEditing(false);
      return;
    }
    const { payload, errors } = toPayload([field], { [field.name]: value }, { [field.name]: initial });
    const rules = validatePayload(payload, { [field.name]: schema.form.constraints.update[field.name] ?? {} }, 'update');
    const problem = errors[field.name] ?? rules[field.name];
    if (problem) {
      setError(problem.join(' '));
      return;
    }
    save.mutate(payload);
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(initial);
      setError(null);
      setEditing(false);
    }
  };

  const errorId = `cell-${schema.name}-${String(item._id)}-${field.name}-error`;
  const common = {
    'aria-label': field.label,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errorId : undefined,
    autoFocus: true,
    disabled: save.isPending,
    className: inputClass,
    onKeyDown,
  };

  let control;
  if (!editing) {
    control = (
      <button
        type="button"
        className={cn('-mx-1 rounded px-1 text-start hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none', error && 'text-destructive')}
        aria-label={t('list.editCell', { name: field.label, value: formatCell(item[field.name], field) })}
        onClick={() => {
          setDraft(initial);
          setEditing(true);
        }}
      >
        <DisplayValue value={item[field.name]} field={field} />
      </button>
    );
  } else if (field.type === 'enum' || field.type === 'boolean') {
    const options: Array<[string, string]> =
      field.type === 'boolean' ? [['true', t('common.yes')], ['false', t('common.no')]] : (field.enumValues ?? []).map((value) => [value, enumLabel(field, value)]);
    control = (
      <select
        {...common}
        value={String(draft)}
        onChange={(event) => {
          const value = field.type === 'boolean' ? event.target.value === 'true' : event.target.value;
          setDraft(value);
          commit(value);
        }}
        onBlur={() => setEditing(false)}
      >
        {field.nullable && field.type === 'enum' && <option value="">{t('common.empty')}</option>}
        {options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    );
  } else if (field.type === 'date') {
    // Saved when a day is picked, or on Enter / leaving the text; Escape cancels.
    control = (
      <DateInput
        id={`cell-${schema.name}-${String(item._id)}-${field.name}`}
        label={field.label}
        value={String(draft)}
        onChange={(value) => {
          setDraft(value);
          commit(value);
        }}
        autoFocus
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="min-w-44"
        onKeyDown={onKeyDown}
      />
    );
  } else {
    const numeric = field.type === 'number' || field.type === 'decimal' || field.type === 'bigint';
    control = (
      <input
        {...common}
        type="text"
        inputMode={numeric ? (field.type === 'bigint' ? 'numeric' : 'decimal') : undefined}
        value={String(draft)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit()}
      />
    );
  }

  return (
    // Clicks inside the cell edit it; they must not open the row's quick view.
    <div className="flex flex-col gap-0.5" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      {control}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

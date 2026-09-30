import { Fragment, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminRecord, FieldSchema, ResourceSchema } from '@nest-my-admin/core/contract';
import { FieldInput } from '@/app/field-input';
import { ObjectInput } from '@/app/object-input';
import { PageMessage } from '@/components/page-message';
import { Button } from '@/components/ui/button';
import { ApiError, api, describeError } from '@/lib/api';
import { formatCell } from '@/lib/format';
import { toFormValues, toPayload, type FormValues } from '@/lib/form-values';
import { useRecord, useSchema } from '@/lib/queries';
import { validatePayload } from '@/lib/validate';

type Mode = 'create' | 'edit';

/** "Customer: Ada Lovelace", or "Customer #3" for records titled by their id. */
function recordHeading(label: string, record: AdminRecord | undefined, id: string | undefined): string {
  const title = typeof record?._title === 'string' ? record._title : `#${id}`;
  return title.startsWith('#') ? `${label} ${title}` : `${label}: ${title}`;
}

export function FormPage({ mode }: { mode: Mode }) {
  const { resource = '', id } = useParams();
  const schema = useSchema(resource);
  const record = useRecord(resource, mode === 'edit' ? id : undefined);

  if (schema.isPending || (mode === 'edit' && record.isPending)) return <PageMessage>Loading…</PageMessage>;
  if (schema.isError) return <PageMessage tone="error">{schema.error.message}</PageMessage>;
  if (mode === 'edit' && record.isError) return <PageMessage tone="error">{record.error.message}</PageMessage>;
  return <RecordForm key={`${resource}:${id ?? 'new'}`} schema={schema.data} mode={mode} id={id} record={record.data} />;
}

interface RecordFormProps {
  schema: ResourceSchema;
  mode: Mode;
  id?: string;
  record?: AdminRecord;
}

function RecordForm({ schema, mode, id, record }: RecordFormProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const names = mode === 'create' ? schema.form.create : schema.form.update;
  const fields = names
    .map((name) => schema.fields.find((field) => field.name === name))
    .filter((field): field is FieldSchema => field !== undefined);
  // What the user started from: the loaded record (or, after "Load theirs", the record as it was then).
  const [base, setBase] = useState<AdminRecord | undefined>(record);
  const [initial, setInitial] = useState<FormValues>(() => toFormValues(fields, record));
  const [values, setValues] = useState<FormValues>(initial);
  const version = schema.version ? base?.[schema.version] : undefined;
  const [conflict, setConflict] = useState<AdminRecord | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: ({ payload, version: expected }: { payload: Record<string, unknown>; version?: unknown }) =>
      mode === 'create' ? api.create(schema.name, payload) : api.update(schema.name, id!, payload, expected),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['list', schema.name] });
      navigate(`/${schema.name}`);
      queryClient.removeQueries({ queryKey: ['record', schema.name] });
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) {
        setFormError(error.message);
        return;
      }
      if (error.status === 409 && error.body.current) {
        setConflict(error.body.current);
        return;
      }
      const entries = Object.entries(error.fields);
      const onForm = (name: string) => names.includes(name.split('.')[0]!); // `address.city` shows in the address group
      const shown = Object.fromEntries(entries.filter(([name]) => onForm(name)));
      const hidden = entries.filter(([name]) => !onForm(name)).map(([name, messages]) => `${name}: ${messages.join(', ')}`);
      setFieldErrors(shown);
      setFormError(Object.keys(shown).length > 0 && hidden.length === 0 ? null : [error.message, ...hidden].join(' — '));
    },
  });

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.remove(schema.name, id!, version),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['list', schema.name] });
      navigate(`/${schema.name}`);
      queryClient.removeQueries({ queryKey: ['record', schema.name, id] });
    },
    onError: (error) => {
      setConfirmingDelete(false);
      setFormError(describeError(error));
    },
  });

  function payloadOf() {
    return toPayload(fields, values, mode === 'edit' ? initial : undefined);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const { payload, errors } = payloadOf();
    const formMode = mode === 'create' ? 'create' : 'update';
    const ruleErrors = validatePayload(payload, schema.form.constraints[formMode], formMode);
    const allErrors = { ...ruleErrors, ...errors }; // conversion errors ("must be a number") win for the same field
    setFieldErrors(allErrors);
    setFormError(null);
    if (Object.keys(allErrors).length === 0) save.mutate({ payload, version });
  }

  /** Save anyway: send the same changes against the version that is stored now. */
  function keepMine(current: AdminRecord) {
    setConflict(null);
    save.mutate({ payload: payloadOf().payload, version: schema.version ? current[schema.version] : undefined });
  }

  /** Drop the edits and continue from the stored record. */
  function loadTheirs(current: AdminRecord) {
    const next = toFormValues(fields, current);
    setConflict(null);
    setBase(current);
    setInitial(next);
    setValues(next);
    setFieldErrors({});
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-5">
      <h1 className="text-xl font-semibold">{mode === 'create' ? `New ${schema.label.toLowerCase()}` : recordHeading(schema.label, record, id)}</h1>
      {conflict && (
        <ConflictNotice
          label={schema.label}
          fields={fields}
          before={base}
          current={conflict}
          busy={save.isPending}
          onKeepMine={() => keepMine(conflict)}
          onLoadTheirs={() => loadTheirs(conflict)}
        />
      )}
      {formError && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </div>
      )}
      {fields.map((field) =>
        field.type === 'object' ? (
          <ObjectInput
            key={field.name}
            resource={schema.name}
            field={field}
            path={field.name}
            pattern={field.name}
            value={values[field.name]}
            constraints={schema.form.constraints[mode === 'create' ? 'create' : 'update']}
            markRequired={mode === 'create'}
            errors={fieldErrors}
            onChange={(value) => setValues((previous) => ({ ...previous, [field.name]: value }))}
          />
        ) : (
          <FieldInput
            key={field.name}
            resource={schema.name}
            field={field}
            value={values[field.name]}
            required={mode === 'create' && schema.form.requiredOnCreate.includes(field.name)}
            errors={fieldErrors[field.name]}
            constraints={schema.form.constraints[mode === 'create' ? 'create' : 'update'][field.name]}
            onChange={(value) => setValues((previous) => ({ ...previous, [field.name]: value }))}
          />
        ),
      )}
      <div className="sticky bottom-0 flex gap-2 border-t bg-background py-3 md:static md:border-0 md:py-0">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="outline" onClick={() => navigate(`/${schema.name}`)}>
          Cancel
        </Button>
        {mode === 'edit' &&
          (confirmingDelete ? (
            <div className="ms-auto flex gap-2">
              <Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
                {remove.isPending ? 'Deleting…' : 'Confirm delete'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                Keep
              </Button>
            </div>
          ) : (
            <Button type="button" variant="outline" className="ms-auto" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          ))}
      </div>
    </form>
  );
}

interface ConflictNoticeProps {
  label: string;
  fields: FieldSchema[];
  before?: AdminRecord;
  current: AdminRecord;
  busy: boolean;
  onKeepMine: () => void;
  onLoadTheirs: () => void;
}

/** 409 on a stale version (spec §9.4): what the other person changed, and the two ways forward. */
function ConflictNotice({ label, fields, before, current, busy, onKeepMine, onLoadTheirs }: ConflictNoticeProps) {
  const changed = fields.filter((field) => JSON.stringify(before?.[field.name] ?? null) !== JSON.stringify(current[field.name] ?? null));
  return (
    <div role="alertdialog" aria-labelledby="conflict-title" aria-describedby="conflict-body" className="flex flex-col gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
      <p id="conflict-title" className="font-medium">
        Someone else saved this {label.toLowerCase()} while you were editing it.
      </p>
      <div id="conflict-body">
        {changed.length > 0 ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {changed.map((field) => (
              <Fragment key={field.name}>
                <dt className="text-muted-foreground">{field.label}</dt>
                <dd>
                  <span className="line-through opacity-60">{formatCell(before?.[field.name], field)}</span> → {formatCell(current[field.name], field)}
                </dd>
              </Fragment>
            ))}
          </dl>
        ) : (
          <p>None of the fields on this form changed.</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={onKeepMine}>
          Keep my changes
        </Button>
        <Button type="button" variant="outline" onClick={onLoadTheirs}>
          Load theirs
        </Button>
      </div>
    </div>
  );
}

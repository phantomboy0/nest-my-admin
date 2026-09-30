import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminRecord, FieldSchema, ResourceSchema } from '@nest-my-admin/core/contract';
import { FieldInput } from '@/app/field-input';
import { PageMessage } from '@/components/page-message';
import { Button } from '@/components/ui/button';
import { ApiError, api, describeError } from '@/lib/api';
import { toFormValues, toPayload, type FormValues } from '@/lib/form-values';
import { useRecord, useSchema } from '@/lib/queries';

type Mode = 'create' | 'edit';

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
  const [initial] = useState<FormValues>(() => toFormValues(fields, record));
  const [values, setValues] = useState<FormValues>(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      mode === 'create' ? api.create(schema.name, payload) : api.update(schema.name, id!, payload),
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
      const entries = Object.entries(error.fields);
      const shown = Object.fromEntries(entries.filter(([name]) => names.includes(name)));
      const hidden = entries.filter(([name]) => !names.includes(name)).map(([name, messages]) => `${name}: ${messages.join(', ')}`);
      setFieldErrors(shown);
      setFormError(Object.keys(shown).length > 0 && hidden.length === 0 ? null : [error.message, ...hidden].join(' — '));
    },
  });

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.remove(schema.name, id!),
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

  function submit(event: FormEvent) {
    event.preventDefault();
    const { payload, errors } = toPayload(fields, values, mode === 'edit' ? initial : undefined);
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length === 0) save.mutate(payload);
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-5">
      <h1 className="text-xl font-semibold">{mode === 'create' ? `New ${schema.label.toLowerCase()}` : `${schema.label} #${id}`}</h1>
      {formError && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </div>
      )}
      {fields.map((field) => (
        <FieldInput
          key={field.name}
          field={field}
          value={values[field.name]}
          required={mode === 'create' && schema.form.requiredOnCreate.includes(field.name)}
          errors={fieldErrors[field.name]}
          onChange={(value) => setValues((previous) => ({ ...previous, [field.name]: value }))}
        />
      ))}
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

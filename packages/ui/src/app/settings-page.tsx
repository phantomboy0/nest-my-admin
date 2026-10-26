import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import type { FieldSchema, PageResponse } from '@nest-my-admin/core/contract';
import { FieldInput } from '@/app/field-input';
import { LeaveBar, SaveBar, SaveKey, useSaveShortcut, useUnsavedGuard, useUploadGate } from '@/app/form-guards';
import { FormLayout } from '@/app/form-layout';
import { ReadOnlyField } from '@/app/form-page';
import { ObjectInput } from '@/app/object-input';
import { PageMessage } from '@/components/page-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLocale, useT } from '@/i18n';
import { api, describeError } from '@/lib/api';
import { shownErrors } from '@/lib/form-errors';
import type { FormValue, FormValues } from '@/lib/form-values';
import { pageFormValues, pagePayload, validatePagePayload } from '@/lib/page-form';
import { usePage } from '@/lib/queries';
import { isShown } from '@/lib/show-if';
import { cn } from '@/lib/utils';

/** `/p/:page`: a settings page (`@AdminSettingsPage`), one form backed by host code. */
export function SettingsPage() {
  const t = useT();
  const { page: name = '' } = useParams();
  const page = usePage(name);
  if (page.isPending) return <PageMessage>{t('common.loading')}</PageMessage>;
  if (page.isError) return <PageMessage tone="error">{describeError(page.error)}</PageMessage>;
  return <SettingsForm key={name} page={page.data} />;
}

function SettingsForm({ page }: { page: PageResponse }) {
  const t = useT();
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const { schema } = page;
  const names = schema.fields.map((field) => field.name);
  const [initial, setInitial] = useState<FormValues>(() => pageFormValues(page));
  const [values, setValues] = useState<FormValues>(initial);
  // Secrets with a stored value whose input was opened with Replace.
  const [replacing, setReplacing] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const uploads = useUploadGate(() => setFormError(null));
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const { blocker } = useUnsavedGuard(dirty);
  const formRef = useRef<HTMLFormElement>(null);
  useSaveShortcut(formRef);

  const change = (name: string, value: FormValue) => setValues((previous) => ({ ...previous, [name]: value }));

  const save = useMutation({
    mutationFn: (changes: Record<string, unknown>) => api.savePage(schema.name, changes),
    // The variables may hold a typed secret: nothing keeps them once the save is done (see `reset()` below).
    gcTime: 0,
    onSuccess: (stored) => {
      save.reset();
      // Continue from the answer: what is stored now, and for secrets only whether one is.
      const next = pageFormValues(stored);
      queryClient.setQueryData(['page', schema.name, locale], stored);
      setInitial(next);
      setValues(next);
      setReplacing([]);
      setFieldErrors({});
      setNotice(t('form.savedName', { name: stored.schema.label }));
    },
    onError: (error) => {
      const shown = shownErrors(error, names);
      setFieldErrors(shown.fields);
      setFormError(shown.form);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (schema.readonly) return; // ⌘S on a read-only page
    setNotice(null);
    if (uploads.busy) {
      setFormError(t('upload.busy'));
      uploads.refuse();
      return;
    }
    const { payload, errors } = pagePayload(schema.fields, values, initial);
    const all = { ...validatePagePayload(payload, schema), ...errors };
    setFieldErrors(all);
    setFormError(null);
    if (Object.keys(all).length > 0) return;
    if (Object.keys(payload).length === 0) {
      // Nothing to send (a clean form, or only spaces typed into a secret): no request and no "saved".
      setValues(initial);
      setReplacing([]);
      return;
    }
    save.mutate(payload);
  }

  // Read-only fields are shown from the answer itself, files included.
  const stored = { ...page.values, _files: page.files };

  function renderField(name: string): ReactNode | null {
    const field = schema.fields.find((candidate) => candidate.name === name);
    if (!field || !isShown(field, values)) return null;
    const required = schema.required.includes(name);
    if (field.secret) {
      return (
        <SecretField
          field={field}
          stored={page.secrets[name] === true}
          value={values[name]}
          replacing={replacing.includes(name)}
          readOnly={schema.readonly}
          required={required}
          errors={fieldErrors[name]}
          onChange={(value) => change(name, value)}
          onReplacing={(on) => setReplacing((current) => (on ? [...current, name] : current.filter((other) => other !== name)))}
        />
      );
    }
    if (schema.readonly) return <ReadOnlyField resource={`page:${schema.name}`} field={field} record={stored} />;
    // Uploads of a page's fields are made for `page:<name>`.
    return field.type === 'object' ? (
      <ObjectInput resource={`page:${schema.name}`} field={field} path={name} pattern={name} value={values[name]} constraints={schema.constraints} markRequired errors={fieldErrors} onChange={(value) => change(name, value)} />
    ) : (
      <FieldInput
        resource={`page:${schema.name}`}
        field={field}
        value={values[name]}
        required={required}
        errors={fieldErrors[name]}
        constraints={schema.constraints[name]}
        onChange={(value) => change(name, value)}
        onBusy={(busy) => uploads.setBusy(name, busy)}
      />
    );
  }

  return (
    <form ref={formRef} onSubmit={submit} noValidate className={cn('flex flex-col gap-5', schema.layout?.length ? 'max-w-4xl' : 'max-w-2xl')}>
      <h1 className="text-[22px] font-bold">{schema.label}</h1>
      {schema.readonly && (
        <p role="note" className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t('settings.viewOnly')}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-md border border-green-600/30 bg-green-500/10 px-3 py-2 text-sm">
          {notice}
        </p>
      )}
      <LeaveBar blocker={blocker} />
      {formError && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </div>
      )}
      <FormLayout layout={schema.layout} names={names} errors={fieldErrors} render={renderField} />
      {!schema.readonly && (
        <SaveBar dirty={dirty}>
          {dirty && (
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={() => {
                setValues(initial);
                setReplacing([]);
                setFieldErrors({});
                setFormError(null);
              }}
            >
              {t('settings.discard')}
            </Button>
          )}
          <Button type="submit" disabled={save.isPending || uploads.busy} aria-keyshortcuts="Control+S Meta+S">
            {t(save.isPending ? 'form.saving' : 'form.save')}
            <SaveKey />
          </Button>
        </SaveBar>
      )}
    </form>
  );
}

interface SecretFieldProps {
  field: FieldSchema;
  /** A value is stored (it is never sent to the browser). */
  stored: boolean;
  /** `''`: leave it alone; text: the new value; `null`: clear it on save. */
  value: FormValue | undefined;
  /** The input was opened with Replace. */
  replacing: boolean;
  readOnly: boolean;
  required: boolean;
  errors?: string[];
  onChange: (value: FormValue) => void;
  onReplacing: (on: boolean) => void;
}

/**
 * A write-only field. With a stored value it shows "Set ✓ · Replace · Clear"; the input appears only for a new value
 * and always starts empty, so nothing that stands for the stored secret can ever be submitted.
 */
function SecretField({ field, stored, value, replacing, readOnly, required, errors, onChange, onReplacing }: SecretFieldProps) {
  const t = useT();
  const id = `field-${field.name}`;
  const labelId = `${id}-label`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const invalid = (errors?.length ?? 0) > 0;
  const describedBy = [field.help ? helpId : undefined, invalid ? errorId : undefined].filter(Boolean).join(' ') || undefined;
  const clearing = value === null;
  const editing = !readOnly && !clearing && (!stored || replacing);
  return (
    <div className="flex flex-col gap-1.5" data-secret={field.name}>
      <label id={labelId} htmlFor={editing ? id : undefined} className="text-sm font-medium">
        {field.label}
        {required && (
          <span aria-hidden className="text-destructive">
            *
          </span>
        )}
      </label>
      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            dir="ltr"
            className="min-w-0 flex-1"
            value={typeof value === 'string' ? value : ''}
            autoFocus={replacing}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event) => onChange(event.target.value)}
          />
          {stored && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange('');
                onReplacing(false);
              }}
            >
              {t('secret.keep')}
            </Button>
          )}
        </div>
      ) : (
        <div role="group" aria-labelledby={labelId} aria-describedby={describedBy} className="flex min-h-8 flex-wrap items-center gap-2 text-sm">
          {clearing ? (
            <>
              <span className="text-amber-800 dark:text-amber-300">{t('secret.willClear')}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
                {t('secret.undo')}
              </Button>
            </>
          ) : stored ? (
            <>
              <span className="inline-flex items-center gap-1 font-medium text-green-800 dark:text-green-300">
                {t('secret.set')}
                <Check className="size-4" aria-hidden />
              </span>
              {!readOnly && (
                <>
                  <Button type="button" variant="outline" size="sm" aria-label={t('secret.replaceName', { name: field.label })} onClick={() => onReplacing(true)}>
                    {t('secret.replace')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" aria-label={t('secret.clearName', { name: field.label })} onClick={() => onChange(null)}>
                    {t('secret.clear')}
                  </Button>
                </>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">{t('secret.notSet')}</span>
          )}
        </div>
      )}
      {field.help && (
        <p id={helpId} className="text-sm text-muted-foreground">
          {field.help}
        </p>
      )}
      {invalid && (
        <p id={errorId} className="text-sm text-destructive">
          {errors!.join(' ')}
        </p>
      )}
    </div>
  );
}

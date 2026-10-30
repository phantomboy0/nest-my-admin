import { useState, type FormEvent, type ReactNode } from 'react';
import { OVERLAY_ANIMATED_CLASS } from '@/components/ui/overlay';
import { Dialog } from 'radix-ui';
import type { ActionSchema } from '@nest-my-admin/core/contract';
import { FieldInput } from '@/app/field-input';
import { FormLayout } from '@/app/form-layout';
import { ObjectInput } from '@/app/object-input';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { actionQuestion } from '@/lib/actions';
import { shownErrors } from '@/lib/form-errors';
import { toFormValues, toPayload, type FormValues } from '@/lib/form-values';
import { isShown } from '@/lib/show-if';
import { validatePayload } from '@/lib/validate';

interface ActionDialogProps {
  /** The resource the action belongs to. */
  resource: string;
  action: ActionSchema;
  /** How many records it runs on (0 for a resource action). */
  count: number;
  /** The record's title, when it runs on one record the page knows. */
  subject?: string;
  running: boolean;
  /** Why the last run failed. */
  error: Error | null;
  onRun: (input: Record<string, unknown> | undefined) => void;
  onClose: () => void;
}

/**
 * The step before an action runs (spec §5.2), mounted while it is open: its question when it wants a confirmation (or is destructive, or runs on
 * several records: `actionQuestion`), its input form when it has
 * one (the same inputs and client checks as record forms), and a destructive button for destructive actions. A failed
 * run keeps the dialog open: field errors go to their inputs, the host's refusal (409, 400) is shown as it was sent.
 */
export function ActionDialog({ resource, action, count, subject, running, error, onRun, onClose }: ActionDialogProps) {
  const t = useT();
  const fields = action.input?.fields ?? [];
  const [values, setValues] = useState<FormValues>(() => toFormValues(fields));
  const [clientErrors, setClientErrors] = useState<Record<string, string[]>>({});
  // What the server said about the last run is shown until the next try, even one the checks here stop.
  const [superseded, setSuperseded] = useState(false);
  const shown = fields.filter((field) => isShown(field, values));
  const server = error && !superseded ? shownErrors(error, fields.map((field) => field.name)) : { fields: {}, form: null };
  const fieldErrors = { ...server.fields, ...clientErrors };

  function submit(event: FormEvent) {
    event.preventDefault();
    event.stopPropagation(); // the dialog is a React child of the page's form: its submit must not save the record
    if (!action.input) return onRun(undefined);
    const { payload, errors } = toPayload(shown, values);
    const constraints = Object.fromEntries(Object.entries(action.input.constraints).filter(([name]) => shown.some((field) => field.name === name.split('.')[0])));
    const all = { ...validatePayload(payload, constraints, 'create'), ...errors };
    setClientErrors(all);
    setSuperseded(Object.keys(all).length > 0);
    if (Object.keys(all).length === 0) onRun(payload);
  }

  const question = actionQuestion(action, count, subject, t);

  function renderField(name: string): ReactNode | null {
    const field = shown.find((candidate) => candidate.name === name);
    if (!field || !action.input) return null;
    const change = (value: FormValues[string]) => setValues((previous) => ({ ...previous, [name]: value }));
    return field.type === 'object' ? (
      <ObjectInput resource={resource} field={field} path={name} pattern={name} value={values[name]} constraints={action.input.constraints} markRequired errors={fieldErrors} idPrefix="action" onChange={change} />
    ) : (
      <FieldInput
        resource={resource}
        field={field}
        value={values[name]}
        required={action.input.required.includes(name)}
        errors={fieldErrors[name]}
        constraints={action.input.constraints[name]}
        idPrefix="action"
        onChange={change}
      />
    );
  }

  return (
    <Dialog.Root open onOpenChange={(next) => !next && !running && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY_ANIMATED_CLASS} />
        <Dialog.Content
          aria-describedby={question ? 'action-question' : undefined}
          className="fixed inset-x-3 top-[12vh] z-50 mx-auto flex max-h-[76vh] max-w-lg flex-col overflow-hidden rounded-xl border bg-background shadow-xl outline-none"
        >
          <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
            <div className="flex flex-col gap-4 overflow-y-auto p-4">
              <Dialog.Title className="text-lg font-semibold">{action.label}</Dialog.Title>
              {question && (
                <p id="action-question" className="text-sm">
                  {question}
                </p>
              )}
              {count > 1 && <p className="text-sm text-muted-foreground">{t(action.atomic ? 'action.atomicNote' : 'action.eachNote', { count })}</p>}
              {server.form && (
                <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {server.form}
                </div>
              )}
              {action.input && <FormLayout layout={undefined} names={fields.map((field) => field.name)} errors={fieldErrors} render={renderField} />}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t p-4">
              <Button type="button" variant="outline" disabled={running} onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant={action.variant === 'destructive' ? 'destructive' : 'default'} disabled={running}>
                {running ? t('action.running') : action.label}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

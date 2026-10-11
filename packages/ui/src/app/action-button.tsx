import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ActionSchema, AdminRecord, ResourceSchema } from '@nest-my-admin/core/contract';
import { ActionDialog } from '@/app/action-dialog';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { api, describeError } from '@/lib/api';
import { actionOutcome, recordActions, runsAtOnce, type ActionOutcome } from '@/lib/actions';
import { iconNamed } from '@/lib/icons';
import { toast } from '@/lib/toast';

interface ActionButtonProps {
  resource: string;
  action: ActionSchema;
  /** The records to run on (encoded ids); leave out for a resource action. */
  ids?: string[];
  /** The record's title, when it runs on one record the page knows (the confirmation names it). */
  subject?: string;
  size?: 'default' | 'sm';
  /** The button cannot be used now; `describedBy` is the id of the text that says why. */
  blocked?: boolean;
  describedBy?: string;
  /** After a successful run, once lists and counts were told to reload. */
  onDone: (outcome: ActionOutcome, ids: string[]) => void;
}

/**
 * A custom action's button (`@AdminAction`). It opens `ActionDialog` when the action asks a question or has a form,
 * and runs on the click otherwise. The server's message is shown as a toast (a default one without a message), and
 * lists, counts and records of the resource reload.
 */
export function ActionButton({ resource, action, ids, subject, size = 'default', blocked = false, describedBy, onDone }: ActionButtonProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const run = useMutation({
    mutationFn: (input: Record<string, unknown> | undefined) => api.runAction(resource, action.name, { ...(ids ? { ids } : {}), ...(input ? { input } : {}) }),
    onSuccess: (result) => {
      const outcome = actionOutcome(result);
      setOpen(false);
      // A selection gets a summary on the page; the toast then only carries what the host said.
      if (outcome.kind !== 'bulk') toast(outcome.message ?? t(outcome.kind === 'record' && outcome.record === null ? 'action.doneGone' : 'action.done', { action: action.label }));
      else if (outcome.message) toast(outcome.message);
      onDone(outcome, ids ?? []);
      for (const key of ['list', 'count', 'record']) void queryClient.invalidateQueries({ queryKey: [key, resource] });
    },
    // Without a dialog there is nowhere else to say why it failed.
    onError: (error) => {
      if (runsAtOnce(action)) toast(describeError(error), 'error');
    },
  });
  const Icon = iconNamed(action.icon);
  return (
    <>
      <Button
        type="button"
        size={size}
        variant={action.variant === 'destructive' ? 'destructive' : 'outline'}
        disabled={blocked || run.isPending}
        aria-describedby={describedBy}
        data-action={action.name}
        onClick={() => {
          run.reset();
          if (runsAtOnce(action)) run.mutate(undefined);
          else setOpen(true);
        }}
      >
        {Icon && <Icon aria-hidden />}
        {action.label}
      </Button>
      {open && (
        <ActionDialog
          resource={resource}
          action={action}
          count={ids?.length ?? 0}
          subject={subject}
          running={run.isPending}
          error={run.error}
          onRun={(input) => run.mutate(input)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

interface RecordActionsProps {
  schema: ResourceSchema;
  record: AdminRecord;
  /** The record's id as the page's URL has it (the key of its cached copy). */
  id: string;
  /** The form has unsaved changes: an action reloads the record, so it waits for a save or a discard. */
  dirty: boolean;
  /** The record is out of the user's view after the action (or gone). */
  onGone: () => void;
  /** The record changed; the cache already holds it as it is now. */
  onChanged: () => void;
}

/** The actions the user may run on this record (`_perm.actions`), in the detail header. */
export function RecordActions({ schema, record, id, dirty, onGone, onChanged }: RecordActionsProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const actions = recordActions(schema, record);
  if (actions.length === 0) return null;
  const noteId = 'record-actions-note';
  return (
    <div role="group" aria-label={t('list.actions')} className="ms-auto flex flex-wrap items-center gap-2">
      {/* Said in words: a disabled button shows no tooltip. */}
      {dirty && (
        <span id={noteId} className="text-xs text-muted-foreground">
          {t('action.saveFirst')}
        </span>
      )}
      {actions.map((action) => (
        <ActionButton
          key={action.name}
          resource={schema.name}
          action={action}
          ids={[id]}
          subject={typeof record._title === 'string' ? record._title : `#${id}`}
          blocked={dirty}
          describedBy={dirty ? noteId : undefined}
          onDone={(outcome) => {
            const stored = outcome.kind === 'record' ? outcome.record : undefined;
            if (stored === null) {
              onGone();
              queryClient.removeQueries({ queryKey: ['record', schema.name, id] });
              return;
            }
            if (stored) queryClient.setQueryData(['record', schema.name, id], stored);
            onChanged();
          }}
        />
      ))}
    </div>
  );
}

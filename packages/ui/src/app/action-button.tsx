import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Ellipsis } from 'lucide-react';
import { Popover } from 'radix-ui';
import type { ActionSchema, AdminRecord, ResourceSchema } from '@nest-my-admin/core/contract';
import { ActionDialog } from '@/app/action-dialog';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { api, describeError } from '@/lib/api';
import { actionOutcome, headerActions, runsAtOnce, type ActionOutcome } from '@/lib/actions';
import { iconNamed } from '@/lib/icons';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

interface ActionButtonProps {
  resource: string;
  action: ActionSchema;
  /** The records to run on (encoded ids); leave out for a resource action. */
  ids?: string[];
  /** The record's title, when it runs on one record the page knows (the confirmation names it). */
  subject?: string;
  size?: 'default' | 'sm';
  className?: string;
  /** The record's next step: filled, with an arrow (the design's «انتقال به آماده ارسال ›»). */
  primary?: boolean;
  /** An entry of the header's ⋯ menu. */
  menuItem?: boolean;
  /** The button cannot be used now; `describedBy` is the id of the text that says why. */
  blocked?: boolean;
  describedBy?: string;
  /** After a successful run, once lists and counts were told to reload. */
  onDone: (outcome: ActionOutcome, ids: string[]) => void;
}

/**
 * A custom action's button (`@AdminAction`). It opens `ActionDialog` when the action asks a question or has a form,
 * is destructive or runs on several records, and runs on the click otherwise. The server's message is shown as a toast (a default one without a message), and
 * lists, counts and records of the resource reload.
 */
export function ActionButton({ resource, action, ids, subject, size = 'default', className, primary = false, menuItem = false, blocked = false, describedBy, onDone }: ActionButtonProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  // A destructive action, or a run on several records, asks first even when the action does not.
  const atOnce = runsAtOnce(action, ids?.length ?? 0);
  const run = useMutation({
    mutationFn: (input: Record<string, unknown> | undefined) => api.runAction(resource, action.name, { ...(ids ? { ids } : {}), ...(input ? { input } : {}) }),
    onSuccess: (result) => {
      const outcome = actionOutcome(result);
      setOpen(false);
      // A selection gets a summary on the page; the toast then only carries what the host said.
      if (outcome.kind !== 'bulk') toast(outcome.message ?? t(outcome.kind === 'record' && outcome.record === null ? 'action.doneGone' : 'action.done', { action: action.label }));
      else if (outcome.message) toast(outcome.message);
      onDone(outcome, ids ?? []);
      for (const key of ['list', 'count', 'record', 'history']) void queryClient.invalidateQueries({ queryKey: [key, resource] });
    },
    // Without a dialog there is nowhere else to say why it failed.
    onError: (error) => {
      if (atOnce) toast(describeError(error), 'error');
    },
  });
  const Icon = iconNamed(action.icon);
  return (
    <>
      <Button
        type="button"
        size={size}
        variant={action.variant === 'destructive' ? 'destructive' : primary ? 'default' : menuItem ? 'ghost' : 'outline'}
        className={cn(menuItem && 'w-full justify-start font-normal', className)}
        disabled={blocked || run.isPending}
        aria-describedby={describedBy}
        data-action={action.name}
        onClick={() => {
          run.reset();
          if (atOnce) run.mutate(undefined);
          else setOpen(true);
        }}
      >
        {Icon && <Icon aria-hidden />}
        {action.label}
        {primary && <ChevronLeft className="ltr:rotate-180" aria-hidden />}
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
  const [menuOpen, setMenuOpen] = useState(false);
  const { primary, buttons, overflow } = headerActions(schema, record);
  if (!primary && buttons.length === 0) return null;
  const noteId = 'record-actions-note';
  const button = (action: ActionSchema, look: { primary?: boolean; menuItem?: boolean } = {}) => (
    <ActionButton
      key={action.name}
      resource={schema.name}
      action={action}
      ids={[id]}
      subject={typeof record._title === 'string' ? record._title : `#${id}`}
      blocked={dirty}
      describedBy={dirty ? noteId : undefined}
      {...look}
      onDone={(outcome) => {
        setMenuOpen(false);
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
  );
  return (
    <div role="group" aria-label={t('list.actions')} className="ms-auto flex flex-wrap items-center gap-2">
      {/* Said in words: a disabled button shows no tooltip. */}
      {dirty && (
        <span id={noteId} className="text-xs text-muted-foreground">
          {t('action.saveFirst')}
        </span>
      )}
      {buttons.map((action) => button(action))}
      {overflow.length > 0 && (
        <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Popover.Trigger asChild>
            <Button type="button" variant="outline" size="icon" aria-label={t('action.more')}>
              <Ellipsis />
            </Button>
          </Popover.Trigger>
          {/* Kept mounted while closed: an entry's confirmation dialog lives in its button. */}
          <Popover.Portal forceMount>
            <Popover.Content forceMount align="end" sideOffset={6} className="z-50 flex min-w-48 flex-col gap-0.5 rounded-[10px] border bg-popover p-1.5 shadow-lg data-[state=closed]:hidden" onClick={() => setMenuOpen(false)}>
              {overflow.map((action) => button(action, { menuItem: true }))}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
      {primary && button(primary, { primary: true })}
    </div>
  );
}

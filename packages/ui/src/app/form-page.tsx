import { Fragment, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Copy, ExternalLink, Lock } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminRecord, FieldSchema, FormLayoutInline, InlineChanges, InlineRows, RecordLink, ResourceSchema } from '@nest-my-admin/core/contract';
import { FieldInput, RichText } from '@/app/field-input';
import { RecordActions } from '@/app/action-button';
import { LeaveBar, useSaveShortcut, useUnsavedGuard, useUploadGate } from '@/app/form-guards';
import { FormLayout } from '@/app/form-layout';
import { InlineSection } from '@/app/inline-section';
import { HistoryTab, historyKey } from '@/app/history-tab';
import { ObjectInput } from '@/app/object-input';
import { DisplayValue, ValueBadge } from '@/app/widgets/badge';
import { PageMessage } from '@/components/page-message';
import { Button } from '@/components/ui/button';
import { ApiError, api, describeError } from '@/lib/api';
import { shownErrors } from '@/lib/form-errors';
import { useLocale, useT } from '@/i18n';
import { formatCell } from '@/lib/format';
import { hasInlineErrors, inlineErrorsOf, inlinePayload, inlineRowsOf, type InlineErrors, type InlineRowsState } from '@/lib/inline-changes';
import { dependencyValues, toFormValues, toPayload, withoutImages, type FormValue, type FormValues } from '@/lib/form-values';
import { useRecord, useSchema, useSession } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { isShown } from '@/lib/show-if';
import { slugify } from '@/lib/slug';
import { validatePayload } from '@/lib/validate';

type Mode = 'create' | 'edit';

/** "Customer: Ada Lovelace", or "Customer #3" for records titled by their id. */
function recordHeading(label: string, record: AdminRecord | undefined, id: string | undefined): string {
  const title = typeof record?._title === 'string' ? record._title : `#${id}`;
  return title.startsWith('#') ? `${label} ${title}` : `${label}: ${title}`;
}

export function FormPage({ mode }: { mode: Mode }) {
  const t = useT();
  const { resource = '', id } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  // Duplicate: `/r/new?from=<id>` starts the create form from that record.
  const from = mode === 'create' ? (searchParams.get('from') ?? undefined) : undefined;
  const loads = mode === 'edit' ? id : from;
  const schema = useSchema(resource);
  const record = useRecord(resource, loads);
  // An action changed the record under the form: the form starts over from what the record is now.
  const [revision, setRevision] = useState(0);
  // Which tab of the record is open. Kept here, above the form, so an action (which remounts the form) leaves the
  // user on History; it belongs to one record, so another record starts on Details.
  const tabOf = `${resource}:${id}`;
  const [openTab, setOpenTab] = useState<{ of: string; tab: RecordTab }>({ of: tabOf, tab: 'details' });
  const tab = openTab.of === tabOf ? openTab.tab : 'details';

  if (schema.isPending || (loads !== undefined && record.isPending)) return <PageMessage>{t('common.loading')}</PageMessage>;
  if (schema.isError) return <PageMessage tone="error">{schema.error.message}</PageMessage>;
  if (loads !== undefined && record.isError) return <PageMessage tone="error">{record.error.message}</PageMessage>;
  const saved = (location.state as { saved?: string } | null)?.saved;
  return (
    <RecordForm
      // Save & new opens /r/new again: a new location key gives it a fresh form.
      key={mode === 'edit' ? `${resource}:${id}:${revision}` : `${resource}:new:${location.key}`}
      schema={schema.data}
      mode={mode}
      id={id}
      record={mode === 'edit' ? record.data : undefined}
      source={from ? record.data : undefined}
      // "Saved" is said once: a form that starts over after an action does not repeat it.
      saved={revision === 0 ? saved : undefined}
      onChanged={() => setRevision((count) => count + 1)}
      tab={tab}
      onTab={(next) => setOpenTab({ of: tabOf, tab: next })}
    />
  );
}

/**
 * A record's values for a copy: without keys, unique values, fields that cannot be written on create, and files
 * (a file belongs to one record; for the same reason rich text is copied without its images, which the server would
 * drop from the copy anyway).
 */
function copyOf(schema: ResourceSchema, source: AdminRecord): AdminRecord {
  const skip = new Set(schema.fields.filter((field) => field.primary || field.unique || field.readonly || field.file).map((field) => field.name));
  const rich = new Set(schema.fields.filter((field) => field.widget === 'richtext').map((field) => field.name));
  return Object.fromEntries(
    Object.entries(source)
      .filter(([name]) => !skip.has(name) && !name.startsWith('_'))
      .map(([name, value]) => [name, rich.has(name) && typeof value === 'string' ? withoutImages(value) : value]),
  ) as AdminRecord;
}

type After = 'list' | 'new' | 'stay';

interface RecordFormProps {
  schema: ResourceSchema;
  mode: Mode;
  id?: string;
  record?: AdminRecord;
  /** Duplicate: the record the create form starts from. */
  source?: AdminRecord;
  /** The title of the record saved just before (Save & new, ⌘S on a new record). */
  saved?: string;
  /** An action changed the record (the cache already holds it as it is now). */
  onChanged: () => void;
  /** Details or History (existing records, with the audit log on). */
  tab: RecordTab;
  onTab: (tab: RecordTab) => void;
}

function RecordForm({ schema, mode, id, record, source, saved, onChanged, tab: openTab, onTab: setTab }: RecordFormProps) {
  const t = useT();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Edit forms also show read-only fields: `readonly` in the config, and those `readonlyIf` locks on this record.
  // Without update permission, or when this record says no (`_perm`), the whole form is read-only.
  const perm = record?._perm as { update?: boolean; delete?: boolean } | undefined;
  const canUpdate = mode === 'create' || (schema.permissions?.update !== false && perm?.update !== false);
  const canDelete = schema.permissions?.delete !== false && perm?.delete !== false;
  const locked = new Set(mode === 'edit' ? (canUpdate ? [...schema.form.readonly, ...lockedOn(record)] : [...schema.form.update, ...schema.form.readonly]) : []);
  const shownNames = mode === 'create' ? schema.form.create : [...schema.form.update, ...schema.form.readonly];
  const allFields = schema.fields.filter((field) => shownNames.includes(field.name));
  const fields = allFields.filter((field) => !locked.has(field.name));
  const names = fields.map((field) => field.name);
  // What the user started from: the loaded record (or, after "Load theirs", the record as it was then).
  const [base, setBase] = useState<AdminRecord | undefined>(record);
  const [initial, setInitial] = useState<FormValues>(() => toFormValues(fields, record ?? (source ? copyOf(schema, source) : undefined)));
  const [values, setValues] = useState<FormValues>(initial);
  // Inline child records (`{ inline: ChildAdmin }` in the layout), saved with the parent. A copy starts without them.
  const inlines = inlinesOf(schema);
  const rowsOf = (from: AdminRecord | undefined): InlineRowsState => Object.fromEntries(inlines.map((inline) => [inline.inline, inlineRowsOf(inline, schema.inlines![inline.inline]!, from)]));
  const [initialRows, setInitialRows] = useState<InlineRowsState>(() => rowsOf(record));
  const [rows, setRows] = useState<InlineRowsState>(initialRows);
  const [inlineErrors, setInlineErrors] = useState<Record<string, InlineErrors>>({});
  const sentInlines = useRef<InlineChanges | undefined>(undefined);
  const version = schema.version ? base?.[schema.version] : undefined;
  const [conflict, setConflict] = useState<AdminRecord | null>(null);
  const dependencies = dependencyValues(fields, values);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // With the audit log on, an existing record has a History tab next to its form. The form stays mounted under it,
  // so edits, the unsaved-changes guard and ⌘S are the same on either tab.
  const session = useSession();
  const hasHistory = mode === 'edit' && id !== undefined && session.data?.audit.enabled === true;
  const tab: RecordTab = hasHistory ? openTab : 'details';
  // Slug fields fill themselves from `slugFrom` until someone types in them (or they already hold a value).
  const typedSlugs = useRef(new Set(fields.filter((field) => field.widget === 'slug' && initial[field.name] !== '').map((field) => field.name)));

  function change(name: string, value: FormValue) {
    setValues((previous) => {
      const next = { ...previous, [name]: value };
      if (typeof value === 'string') {
        for (const field of fields) {
          if (field.slugFrom === name && !typedSlugs.current.has(field.name)) next[field.name] = slugify(value);
        }
      }
      return next;
    });
    if (fields.some((field) => field.name === name && field.widget === 'slug')) typedSlugs.current.add(name);
  }

  const [notice, setNotice] = useState<string | null>(saved ? t('form.savedName', { name: saved }) : null);
  // "Wait for the uploads" has nothing left to say once they are done.
  const uploads = useUploadGate(() => setFormError(null));

  // Unsaved changes: in-app navigation asks first (an inline bar), closing the tab asks through the browser.
  const dirty = JSON.stringify(values) !== JSON.stringify(initial) || JSON.stringify(rows) !== JSON.stringify(initialRows);
  const { blocker, release } = useUnsavedGuard(dirty);

  const formRef = useRef<HTMLFormElement>(null);
  const after = useRef<After>('list');
  // ⌘S / Ctrl+S saves and stays on the record.
  useSaveShortcut(formRef, () => {
    after.current = 'stay';
  });

  const save = useMutation({
    mutationFn: ({ payload, version: expected }: { payload: Record<string, unknown>; version?: unknown; then: After }) =>
      mode === 'create' ? api.create(schema.name, payload) : api.update(schema.name, id!, payload, expected),
    onSuccess: async (stored, { then }) => {
      void queryClient.invalidateQueries({ queryKey: historyKey(schema.name) });
      await queryClient.invalidateQueries({ queryKey: ['list', schema.name] });
      const title = typeof stored._title === 'string' ? stored._title : `#${String(stored._id)}`;
      if (then === 'stay' && mode === 'edit') {
        // Continue from what was stored; the record query refetches for `_readonly` and `_links`.
        const next = toFormValues(fields, stored);
        const nextRows = rowsOf(stored);
        setBase(stored);
        setInitial(next);
        setValues(next);
        setInitialRows(nextRows);
        setRows(nextRows);
        setInlineErrors({});
        setNotice(t('form.savedName', { name: title }));
        await queryClient.invalidateQueries({ queryKey: ['record', schema.name, id] });
        return;
      }
      release();
      queryClient.removeQueries({ queryKey: ['record', schema.name] });
      if (then === 'new') navigate(`/${schema.name}/new`, { state: { saved: title } });
      else if (then === 'stay') navigate(`/${schema.name}/${encodeURIComponent(String(stored._id))}`, { replace: true, state: { saved: title } });
      else navigate(`/${schema.name}`);
    },
    onError: (error) => {
      setTab('details'); // field errors and the conflict's choices are on the form
      if (!(error instanceof ApiError)) {
        setFormError(error.message);
        return;
      }
      if (error.status === 409 && error.body.current) {
        setConflict(error.body.current);
        return;
      }
      const shown = shownErrors(error, [...names, '_inlines']);
      const split = inlineErrorsOf(shown.fields, sentInlines.current);
      setFieldErrors(split.parent);
      setInlineErrors(split.inlines);
      setFormError(shown.form);
    },
  });

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.remove(schema.name, id!, version),
    onSuccess: async () => {
      release();
      await queryClient.invalidateQueries({ queryKey: ['list', schema.name] });
      navigate(`/${schema.name}`);
      queryClient.removeQueries({ queryKey: ['record', schema.name, id] });
    },
    onError: (error) => {
      setConfirmingDelete(false);
      setFormError(describeError(error));
    },
  });

  /** Fields hidden by `showIf` are not sent (and not checked): hiding is presentation, the server keeps their values. */
  const visible = fields.filter((field) => isShown(field, values));

  function payloadOf() {
    const own = toPayload(visible, values, mode === 'edit' ? initial : undefined);
    const children = inlinePayload(inlines, schema.inlines ?? {}, initialRows, rows, (inline, count) =>
      inline.min !== undefined && count < inline.min ? t('inline.countMin', { min: inline.min, count }) : count > inline.max ? t('inline.countMax', { max: inline.max, count }) : null,
    );
    sentInlines.current = children.changes;
    return { payload: children.changes ? { ...own.payload, _inlines: children.changes } : own.payload, errors: own.errors, inlineErrors: children.errors };
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canUpdate) return; // ⌘S on a read-only form
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const then: After = submitter?.value === 'new' ? 'new' : submitter ? 'list' : after.current;
    after.current = 'list';
    setNotice(null);
    if (uploads.busy) {
      setFormError(t('upload.busy')); // ⌘S while a file travels; the buttons are disabled
      uploads.refuse();
      return;
    }
    const { payload, errors, inlineErrors: rowErrors } = payloadOf();
    const formMode = mode === 'create' ? 'create' : 'update';
    const constraints = Object.fromEntries(Object.entries(schema.form.constraints[formMode]).filter(([name]) => visible.some((field) => field.name === name.split('.')[0])));
    const ruleErrors = validatePayload(payload, constraints, formMode);
    const allErrors = { ...ruleErrors, ...errors }; // conversion errors ("must be a number") win for the same field
    setFieldErrors(allErrors);
    setInlineErrors(rowErrors);
    setFormError(null);
    if (Object.keys(allErrors).length === 0 && !hasInlineErrors(rowErrors)) save.mutate({ payload, version, then });
    else setTab('details'); // ⌘S from the History tab: the errors are on the form
  }

  /** Save anyway: send the same changes against the version that is stored now. */
  function keepMine(current: AdminRecord) {
    setConflict(null);
    save.mutate({ payload: payloadOf().payload, version: schema.version ? current[schema.version] : undefined, then: save.variables?.then ?? 'list' });
  }

  /** Drop the edits and continue from the stored record. */
  function loadTheirs(current: AdminRecord) {
    const next = toFormValues(fields, current);
    setConflict(null);
    setBase(current);
    setInitial(next);
    setValues(next);
    setFieldErrors({});
    // The 409's `current` is the parent alone: the rows keep their edits, against the rows as they were read.
  }

  function renderInline(inline: FormLayoutInline): ReactNode | null {
    const child = schema.inlines?.[inline.inline];
    if (!child) return null;
    const read = (record?._inlines as Record<string, InlineRows> | undefined)?.[inline.inline];
    const truncated = read?.truncated && id !== undefined ? { total: read.total, href: `/${child.name}?${new URLSearchParams({ [`filter[${inline.link}]`]: String(record?.[schema.primaryKeys[0]!] ?? id) })}` } : undefined;
    return (
      <InlineSection
        inline={inline}
        child={child}
        rows={rows[inline.inline] ?? []}
        onChange={(next) => setRows((previous) => ({ ...previous, [inline.inline]: next }))}
        readOnly={!canUpdate || truncated !== undefined}
        errors={inlineErrors[inline.inline]}
        parent={schema.name}
        parentValues={dependencies}
        onBusy={uploads.setBusy}
        truncated={truncated}
      />
    );
  }

  function renderField(name: string): ReactNode | null {
    const field = allFields.find((candidate) => candidate.name === name);
    if (!field || !isShown(field, values)) return null;
    if (locked.has(name)) return <ReadOnlyField resource={schema.name} field={field} record={record} />;
    const formMode = mode === 'create' ? 'create' : 'update';
    return field.type === 'object' ? (
      <ObjectInput
        resource={schema.name}
        field={field}
        path={field.name}
        pattern={field.name}
        value={values[field.name]}
        constraints={schema.form.constraints[formMode]}
        markRequired={mode === 'create'}
        errors={fieldErrors}
        onChange={(value) => change(field.name, value)}
      />
    ) : (
      <FieldInput
        resource={schema.name}
        field={field}
        value={values[field.name]}
        required={mode === 'create' && schema.form.requiredOnCreate.includes(field.name)}
        errors={fieldErrors[field.name]}
        formValues={field.type === 'relation' ? dependencies : undefined}
        constraints={schema.form.constraints[formMode][field.name]}
        onChange={(value) => change(field.name, value)}
        onBusy={(busy) => uploads.setBusy(field.name, busy)}
      />
    );
  }

  return (
    <form ref={formRef} onSubmit={submit} noValidate className={cn('flex flex-col gap-5', schema.form.layout?.length ? 'max-w-4xl' : 'max-w-2xl')}>
      {mode === 'create' ? (
        <h1 className="text-xl font-semibold">{t('form.new', { name: schema.label })}</h1>
      ) : (
        <DetailHeader
          schema={schema}
          record={record}
          id={id}
          dirty={dirty}
          onGone={() => {
            release();
            navigate(`/${schema.name}`);
          }}
          onChanged={onChanged}
        />
      )}
      {source && inlines.length > 0 && (
        <p role="note" className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t('inline.duplicateNote', { names: new Intl.ListFormat(locale).format(inlines.map((inline) => inline.label)) })}
        </p>
      )}
      {!canUpdate && (
        <p role="note" className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t('form.viewOnly')}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-md border border-green-600/30 bg-green-500/10 px-3 py-2 text-sm">
          {notice}
        </p>
      )}
      <LeaveBar blocker={blocker} />
      {hasHistory && <RecordTabs active={tab} onChange={setTab} />}
      {conflict && (
        <ConflictNotice
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
      {hasHistory && tab === 'history' && (
        <div role="tabpanel" id="record-panel-history" aria-labelledby="record-tab-history">
          <HistoryTab schema={schema} id={id!} record={record} />
        </div>
      )}
      {/* `contents`: the form's own blocks keep their place in the column; hidden (not unmounted) under History. */}
      <div
        className={tab === 'details' ? 'contents' : 'hidden'}
        {...(hasHistory ? { role: 'tabpanel', id: 'record-panel-details', 'aria-labelledby': 'record-tab-details' } : {})}
      >
        <FormLayout
          layout={schema.form.layout}
          names={allFields.map((field) => field.name)}
          errors={{ ...fieldErrors, ...Object.fromEntries(Object.entries(inlineErrors).filter(([, found]) => hasInlineErrors({ found })).map(([child]) => [`_inlines.${child}`, ['']])) }}
          render={renderField}
          renderInline={renderInline}
        />
        <div className="sticky bottom-0 flex flex-wrap gap-2 border-t bg-background py-3 md:static md:border-0 md:py-0">
          {canUpdate && (
            <Button type="submit" value="list" disabled={save.isPending || uploads.busy} aria-keyshortcuts="Control+S Meta+S">
              {t(save.isPending ? 'form.saving' : 'form.save')}
            </Button>
          )}
          {canUpdate && schema.creatable && (
            <Button type="submit" value="new" variant="outline" disabled={save.isPending || uploads.busy}>
              {t('form.saveAndNew')}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => navigate(`/${schema.name}`)}>
            {t(canUpdate ? 'common.cancel' : 'form.back')}
          </Button>
          {mode === 'edit' && schema.creatable && (
            <Button asChild variant="outline">
              <Link to={`/${schema.name}/new?${new URLSearchParams({ from: id! })}`}>
                <Copy />
                {t('form.duplicate')}
              </Link>
            </Button>
          )}
          {mode === 'edit' &&
            canDelete &&
            (confirmingDelete ? (
              <div className="ms-auto flex gap-2">
                <Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
                  {t(remove.isPending ? 'form.deleting' : schema.softDelete ? 'form.confirmMoveToTrash' : 'form.confirmDelete')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                  {t('form.keep')}
                </Button>
              </div>
            ) : (
              <Button type="button" variant="outline" className="ms-auto" onClick={() => setConfirmingDelete(true)}>
                {t(schema.softDelete ? 'form.moveToTrash' : 'form.delete')}
              </Button>
            ))}
        </div>
        {mode === 'edit' && record && schema.related.length > 0 && (
          <nav aria-label={t('form.related')} className="flex flex-col gap-2 border-t pt-4">
            <h2 className="text-sm font-medium text-muted-foreground">{t('form.related')}</h2>
            <ul className="flex flex-wrap gap-2">
              {schema.related.map((related) => (
                <li key={`${related.resource}:${related.field}`}>
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/${related.resource}?${new URLSearchParams({ [`filter[${related.field}][${related.operator}]`]: String(record[schema.primaryKeys[0]!]) })}`}>
                      {related.label}
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </form>
  );
}

/** The inline sections of the layout (tabs included) whose child this user may see. */
function inlinesOf(schema: ResourceSchema): FormLayoutInline[] {
  return (schema.form.layout ?? [])
    .flatMap((node) => ('tab' in node ? node.sections : [node]))
    .filter((node): node is FormLayoutInline => 'inline' in node && schema.inlines?.[node.inline] !== undefined);
}

type RecordTab = 'details' | 'history';
const RECORD_TABS: RecordTab[] = ['details', 'history'];

/** Details · History on an existing record. Arrow keys move between the two, as in the form's own tabs. */
function RecordTabs({ active, onChange }: { active: RecordTab; onChange: (tab: RecordTab) => void }) {
  const t = useT();
  const buttons = useRef<Partial<Record<RecordTab, HTMLButtonElement | null>>>({});
  return (
    <div
      role="tablist"
      aria-label={t('audit.recordTabs')}
      className="flex gap-1 overflow-x-auto border-b"
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'details' : event.key === 'End' ? 'history' : active === 'details' ? 'history' : 'details';
        onChange(next);
        buttons.current[next]?.focus();
      }}
    >
      {RECORD_TABS.map((name) => (
        <button
          key={name}
          ref={(element) => {
            buttons.current[name] = element;
          }}
          id={`record-tab-${name}`}
          type="button"
          role="tab"
          aria-selected={name === active}
          // The History panel exists only while it is open; the form's panel is always there (hidden).
          aria-controls={name === 'details' || active === 'history' ? `record-panel-${name}` : undefined}
          tabIndex={name === active ? 0 : -1}
          onClick={() => onChange(name)}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
            name === active ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {t(name === 'details' ? 'audit.details' : 'audit.history')}
        </button>
      ))}
    </div>
  );
}

const lockedOn = (record: AdminRecord | undefined): string[] => (Array.isArray(record?._readonly) ? (record._readonly as string[]) : []);

/** A field shown but not editable: its value as text (files and rich text as they look), with a lock. */
export function ReadOnlyField({ resource, field, record }: { resource: string; field: FieldSchema; record: AdminRecord | undefined }) {
  const t = useT();
  const value = record?.[field.name];
  return (
    <div className="flex flex-col gap-1.5" data-readonly={field.name}>
      <span className="flex items-center gap-1.5 text-sm font-medium">
        {field.label}
        <Lock className="size-3.5 text-muted-foreground" aria-label={t('form.readOnly')} role="img" />
      </span>
      <div className="min-h-8 rounded-lg bg-muted/50 px-2.5 py-1.5 text-sm break-words">
        {field.widget === 'richtext' && typeof value === 'string' && value !== '' ? (
          <RichText id={`field-${field.name}`} resource={resource} field={field} value={value} readOnly />
        ) : (
          <DisplayValue value={value} field={field} record={record} detailed />
        )}
      </div>
      {field.help && <p className="text-sm text-muted-foreground">{field.help}</p>}
    </div>
  );
}

interface DetailHeaderProps {
  schema: ResourceSchema;
  record?: AdminRecord;
  id?: string;
  /** The form has unsaved changes: actions wait, since they reload the record. */
  dirty: boolean;
  /** An action left the record out of the user's view (or removed it). */
  onGone: () => void;
  onChanged: () => void;
}

/** The record's title with its badge fields, its actions, and the resource's external links (spec §9.4). */
function DetailHeader({ schema, record, id, dirty, onGone, onChanged }: DetailHeaderProps) {
  const t = useT();
  const badges = schema.fields.filter((field) => field.widget === 'badge' && record?.[field.name] !== undefined && record?.[field.name] !== null);
  const links = Array.isArray(record?._links) ? (record._links as RecordLink[]) : [];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{recordHeading(schema.label, record, id)}</h1>
        {badges.map((field) => (
          <ValueBadge key={field.name} value={record![field.name]} field={field} />
        ))}
        {record && id !== undefined && <RecordActions schema={schema} record={record} id={id} dirty={dirty} onGone={onGone} onChanged={onChanged} />}
      </div>
      {links.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {links.map((link) => (
            <li key={`${link.label}:${link.href}`}>
              <a href={link.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline" aria-label={t('form.externalLink', { name: link.label })}>
                {link.label}
                <ExternalLink className="size-3.5 rtl:-scale-x-100" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ConflictNoticeProps {
  fields: FieldSchema[];
  before?: AdminRecord;
  current: AdminRecord;
  busy: boolean;
  onKeepMine: () => void;
  onLoadTheirs: () => void;
}

/** 409 on a stale version (spec §9.4): what the other person changed, and the two ways forward. */
function ConflictNotice({ fields, before, current, busy, onKeepMine, onLoadTheirs }: ConflictNoticeProps) {
  const t = useT();
  const changed = fields.filter((field) => JSON.stringify(before?.[field.name] ?? null) !== JSON.stringify(current[field.name] ?? null));
  return (
    <div role="alertdialog" aria-labelledby="conflict-title" aria-describedby="conflict-body" className="flex flex-col gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
      <p id="conflict-title" className="font-medium">
        {t('form.conflictTitle')}
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
          <p>{t('form.conflictNone')}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={onKeepMine}>
          {t('form.keepMine')}
        </Button>
        <Button type="button" variant="outline" onClick={onLoadTheirs}>
          {t('form.loadTheirs')}
        </Button>
      </div>
    </div>
  );
}

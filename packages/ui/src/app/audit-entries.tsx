import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import type { AuditEntry, FieldSchema, ResourceSchema } from '@nest-my-admin/core/contract';
import { Button } from '@/components/ui/button';
import { formatDateTime, formatRelative, useLocale } from '@/i18n';
import { changeRow, entrySubject, eventDetail, eventLabel, formatAuditValue, isAnonymous, restrictedNote, type AuditNames, type ChangeRow, type TitleOf } from '@/lib/audit';

interface AuditEntriesProps {
  entries: AuditEntry[];
  /**
   * When the entries were fetched (the query's `dataUpdatedAt`): "2 minutes ago" is counted from there, so a list that
   * reloads under a mounted page moves on with its data.
   */
  now: Date;
  names: AuditNames;
  /** The reader's schema of a resource, when they have one (labels and formatters for its fields). */
  schemaOf: (resource: string) => ResourceSchema | undefined;
  /** The fields of a settings page, when the page holds them (labels and formatters for a page's changes). */
  pageFieldsOf?: (page: string) => FieldSchema[] | undefined;
  /** Titles of related records the page already holds (the open record's own references). */
  titleOf?: (field: string, id: string) => string | undefined;
  /** The audit page: each entry names its record and links to it, and an actor's name filters by them. */
  onActor?: (id: string) => void;
  showSubject?: boolean;
}

/** Audit entries, newest first: what happened, who did it and when, then the changed fields. */
export function AuditEntries({ entries, now, names, schemaOf, pageFieldsOf, titleOf, onActor, showSubject = false }: AuditEntriesProps) {
  const { t } = useLocale();
  return (
    <ol aria-label={t('audit.entries')} className="flex flex-col divide-y rounded-card border bg-card shadow-card">
      {entries.map((entry) => (
        <Entry
          key={entry.id}
          entry={entry}
          now={now}
          names={names}
          schema={entry.resource !== undefined ? schemaOf(entry.resource) : undefined}
          pageFields={entry.resource === undefined && entry.meta?.page !== undefined ? pageFieldsOf?.(entry.meta.page) : undefined}
          titleOf={titleOf}
          onActor={onActor}
          showSubject={showSubject}
        />
      ))}
    </ol>
  );
}

interface EntryProps extends Omit<AuditEntriesProps, 'entries' | 'schemaOf' | 'pageFieldsOf'> {
  entry: AuditEntry;
  schema: ResourceSchema | undefined;
  pageFields: FieldSchema[] | undefined;
}

const GONE = /\.(deleted|purged)$/;

function Entry({ entry, now, names, schema, pageFields, titleOf, onActor, showSubject }: EntryProps) {
  const fields = schema?.fields ?? pageFields;
  const { t } = useLocale();
  const at = new Date(entry.at);
  const valid = !Number.isNaN(at.getTime());
  const subject = showSubject ? entrySubject(entry, names) : undefined;
  // A link only to a record that the entry says is still there.
  const link = showSubject && entry.resource !== undefined && entry.recordId !== undefined && !GONE.test(entry.event) && !entry.meta?.deleted;
  const note = restrictedNote(entry);
  const detail = eventDetail(entry);
  const actorName = entry.actor ? (entry.actor.name ?? `#${entry.actor.id}`) : t('audit.noActor');
  const input = entry.meta?.input ? Object.entries(entry.meta.input) : [];
  const inputFields = entry.meta?.action !== undefined ? schema?.actions?.find((action) => action.name === actionName(entry))?.input?.fields : undefined;
  const client = [entry.meta?.ip, entry.meta?.userAgent].filter(Boolean).join(' · ');
  return (
    <li className="flex flex-col gap-2 px-4 py-3 text-sm" data-event={entry.event} data-actor={entry.actor?.id ?? ''} data-anonymous={isAnonymous(entry) || undefined}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-medium">{eventLabel(entry, names)}</span>
        {subject !== undefined &&
          (link ? (
            <Link to={`/${entry.resource}/${encodeURIComponent(entry.recordId!)}`} className="text-primary hover:underline">
              {subject}
            </Link>
          ) : (
            <span>{subject}</span>
          ))}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        {entry.actor && onActor ? (
          <button type="button" className="font-medium text-foreground hover:underline" aria-label={t('audit.filterByActor', { name: actorName })} onClick={() => onActor(entry.actor!.id)}>
            {actorName}
          </button>
        ) : (
          <span className="font-medium text-foreground">{actorName}</span>
        )}
        {entry.viewAsBy !== undefined && <span>{t('audit.viewAsBy', { id: entry.viewAsBy })}</span>}
        {valid ? (
          <time dateTime={entry.at}>
            {formatRelative(at, now)} · {formatDateTime(at)}
          </time>
        ) : (
          <span>{entry.at}</span>
        )}
      </div>
      {detail !== undefined && <p className="text-muted-foreground">{detail}</p>}
      {note !== undefined && <p className="text-muted-foreground">{note}</p>}
      {entry.changes !== undefined && entry.changes.length > 0 && (
        <dl aria-label={t('audit.changedFields')} className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(6rem,auto)_1fr]">
          {entry.changes.map((change) => {
            const field = fields?.find((candidate) => candidate.name === change.field);
            return <Change key={change.field} row={changeRow(change, field, titleOf ? (id) => titleOf(change.field, id) : undefined)} />;
          })}
        </dl>
      )}
      {input.length > 0 && (
        <dl aria-label={t('audit.input')} className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(6rem,auto)_1fr]">
          {input.map(([key, value]) => {
            const field = inputFields?.find((candidate: FieldSchema) => candidate.name === key);
            return (
              <div key={key} className="contents" data-input={key}>
                <dt className="text-muted-foreground">{field?.label ?? key}</dt>
                <dd className="min-w-0">
                  <LongText text={formatAuditValue(value, field)} />
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {entry.meta?.inputTruncated && <p className="text-muted-foreground">{t('audit.inputTruncated')}</p>}
      {client !== '' && (
        <p className="text-xs break-all text-muted-foreground" dir="ltr" data-client>
          {client}
        </p>
      )}
    </li>
  );
}

/** `order.action.ship` → `ship`. */
function actionName(entry: AuditEntry): string | undefined {
  const prefix = `${entry.resource}.action.`;
  return entry.event.startsWith(prefix) ? entry.event.slice(prefix.length) : undefined;
}

function Change({ row }: { row: ChangeRow }) {
  const { t } = useLocale();
  return (
    <div className="contents" data-change={row.field} data-state={row.state}>
      <dt className="text-muted-foreground">{row.label}</dt>
      <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {row.state === 'values' ? (
          <>
            {row.before !== undefined && (
              <span className="min-w-0 text-muted-foreground line-through decoration-muted-foreground/50" data-before>
                <span className="sr-only">{t('audit.before')}: </span>
                <LongText text={row.before} />
              </span>
            )}
            {row.before !== undefined && row.after !== undefined && (
              <>
                <ArrowRight className="size-3.5 shrink-0 self-center text-muted-foreground rtl:-scale-x-100" aria-hidden />
                <span className="sr-only">{t('audit.becomes')}</span>
              </>
            )}
            {row.after !== undefined && (
              <span className="min-w-0" data-after>
                {row.before === undefined && <span className="sr-only">{t('audit.after')}: </span>}
                <LongText text={row.after} />
              </span>
            )}
            {row.truncated && <span className="text-xs text-muted-foreground">({t('audit.field.truncated')})</span>}
          </>
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t(`audit.field.${row.state}`)}</span>
        )}
      </dd>
    </div>
  );
}

const SHORT = 160;

/** Text as text (never HTML); long values start collapsed. */
function LongText({ text }: { text: string }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  // `dir="auto"`: a value takes the direction of its own text, whatever the page's language.
  if (text.length <= SHORT) {
    return (
      <span dir="auto" className="break-words whitespace-pre-wrap">
        {text}
      </span>
    );
  }
  return (
    <span dir="auto" className="break-words whitespace-pre-wrap">
      {open ? text : `${text.slice(0, SHORT).trimEnd()}…`}{' '}
      <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {t(open ? 'audit.showLess' : 'audit.showMore')}
      </Button>
    </span>
  );
}

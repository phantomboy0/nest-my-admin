import { Fragment, useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import type { FieldSchema, FormLayoutInline, ResourceSchema } from '@nest-my-admin/core/contract';
import { FieldInput } from '@/app/field-input';
import { FormLayout } from '@/app/form-layout';
import { ObjectInput } from '@/app/object-input';
import { DisplayValue } from '@/app/widgets/badge';
import { ComputedCell } from '@/app/computed-cell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fieldWarnings } from '@/lib/record-layout';
import { useT } from '@/i18n';
import { dependencyValues, type FormValue } from '@/lib/form-values';
import { inlineFields, lockedFields, newInlineRow, type InlineErrors, type InlineRow } from '@/lib/inline-changes';
import { cn } from '@/lib/utils';

interface InlineSectionProps {
  inline: FormLayoutInline;
  /** The child's schema, cut for this user (`ResourceSchema.inlines`). */
  child: ResourceSchema;
  rows: InlineRow[];
  onChange: (rows: InlineRow[]) => void;
  /** Nothing can change: the parent is read-only, or the rows are `truncated`. */
  readOnly: boolean;
  errors?: InlineErrors;
  /** The parent resource and its form values as JSON (`_parent` of the child's pickers). */
  parent: string;
  parentValues?: string;
  /** Told while a row's field uploads, so the parent form waits with saving. */
  onBusy: (name: string, busy: boolean) => void;
  /** More rows exist than the form edits: how many, and the child's list filtered by this parent. */
  truncated?: { total: number; href: string };
  /** The parent's `_perm.inlines.<child>.create`: false when the child's `@AdminCan('create')` refuses new rows here. */
  canAdd?: boolean;
}

/**
 * A child resource edited in its parent's form (spec §9): a table (one row per child) or stacked cards (the child's
 * form layout per child). Add, remove and reorder follow the child's permissions and each row's `_perm`; nothing is
 * saved here, the parent's Save sends every change at once.
 */
export function InlineSection({ inline, child, rows, onChange, readOnly, errors, parent, parentValues, onBusy, truncated, canAdd = true }: InlineSectionProps) {
  const t = useT();
  const titleId = useId();
  const fields = inlineFields(inline, child);
  const next = useRef(0);
  const [dragging, setDragging] = useState<number | null>(null);
  const canCreate = !readOnly && canAdd && child.permissions?.create !== false && child.form.create.length > 0 && rows.length < inline.max;
  const ordered = !readOnly && inline.order !== undefined && child.form.update.includes(inline.order) && rows.length > 1;
  const canRemove = (row: InlineRow) => !readOnly && (row.id === undefined || (child.permissions?.delete !== false && (row.record?._perm as { delete?: boolean } | undefined)?.delete !== false));
  // The child's pickers see the parent's form as `_parent`, next to the row's own values.
  const valuesFor = (row: InlineRow) => (parentValues === undefined ? undefined : JSON.stringify({ ...JSON.parse(dependencyValues(fields, row.values) ?? '{}'), _parent: JSON.parse(parentValues) }));

  function add() {
    let key: string;
    do key = `n${++next.current}`;
    while (rows.some((row) => row.key === key));
    onChange([...rows, newInlineRow(inline, child, key)]);
  }
  const update = (key: string, name: string, value: FormValue) => onChange(rows.map((row) => (row.key === key ? { ...row, values: { ...row.values, [name]: value } } : row)));
  const remove = (key: string) => onChange(rows.filter((row) => row.key !== key));
  function move(from: number, to: number) {
    if (to < 0 || to >= rows.length || from === to) return;
    const moved = [...rows];
    moved.splice(to, 0, moved.splice(from, 1)[0]!);
    onChange(moved);
  }

  function cell(row: InlineRow, field: FieldSchema, compact: boolean): ReactNode {
    const prefix = `inline-${child.name}-${row.key}`;
    const rowErrors = errors?.rows[row.key] ?? {};
    const creating = row.id === undefined;
    const editable = !readOnly && (creating ? child.form.create : child.form.update).includes(field.name) && !lockedFields(row, child).has(field.name);
    if (!editable) {
      if (creating) return null; // not written on create: the server fills it
      // A read-only inline reads as a table of values (the design's order items).
      if (inline.readonly && compact) return <DisplayValue value={row.record?.[field.name]} field={field} record={row.record} />;
      return (
        <div className="flex flex-col gap-1.5" data-readonly={field.name}>
          {!compact && <span className="text-sm font-medium">{field.label}</span>}
          <div className="min-h-8 rounded-lg bg-muted/50 px-2.5 py-1.5 text-sm break-words">
            <DisplayValue value={row.record?.[field.name]} field={field} record={row.record} />
          </div>
        </div>
      );
    }
    const mode = creating ? 'create' : 'update';
    if (field.type === 'object') {
      return (
        <ObjectInput
          resource={child.name}
          field={field}
          path={field.name}
          pattern={field.name}
          value={row.values[field.name]}
          constraints={child.form.constraints[mode]}
          markRequired={creating}
          errors={rowErrors}
          idPrefix={prefix}
          onChange={(value) => update(row.key, field.name, value)}
        />
      );
    }
    const warning = fieldWarnings([field], row.values)[field.name];
    const input = (
      <FieldInput
        resource={child.name}
        field={field}
        value={row.values[field.name]}
        required={creating && child.form.requiredOnCreate.includes(field.name)}
        errors={rowErrors[field.name]}
        constraints={child.form.constraints[mode][field.name]}
        formValues={field.type === 'relation' ? valuesFor(row) : undefined}
        parent={parent}
        idPrefix={prefix}
        hideLabel={compact}
        onChange={(value) => update(row.key, field.name, value)}
        onBusy={(busy) => onBusy(`${child.name}:${row.key}:${field.name}`, busy)}
      />
    );
    // A soft warning (`warnIf`, an image without alt text): shown, never blocking the save.
    if (!warning) return input;
    return (
      <div className="flex flex-col gap-1">
        {input}
        <p className="flex items-center gap-1 text-xs text-warn">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          {warning}
        </p>
      </div>
    );
  }

  function controls(row: InlineRow, index: number): ReactNode {
    const name = t('inline.row', { name: inline.label, index: index + 1 });
    return (
      <div className="flex items-center gap-1">
        {ordered && (
          <>
            <span
              className="cursor-grab text-muted-foreground"
              draggable
              aria-hidden
              onDragStart={(event: DragEvent) => {
                event.dataTransfer.effectAllowed = 'move';
                setDragging(index);
              }}
              onDragEnd={() => setDragging(null)}
            >
              <GripVertical className="size-4" />
            </span>
            <Button type="button" variant="ghost" size="icon-sm" disabled={index === 0} aria-label={t('inline.moveUp', { name })} onClick={() => move(index, index - 1)}>
              <ArrowUp />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" disabled={index === rows.length - 1} aria-label={t('inline.moveDown', { name })} onClick={() => move(index, index + 1)}>
              <ArrowDown />
            </Button>
          </>
        )}
        {canRemove(row) && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t('inline.remove', { name })} onClick={() => remove(row.key)}>
            <Trash2 />
          </Button>
        )}
      </div>
    );
  }

  // Dropping a dragged row on another puts it in that row's place.
  const dropTarget = (index: number) =>
    ordered
      ? {
          onDragOver: (event: DragEvent) => {
            if (dragging !== null) event.preventDefault();
          },
          onDrop: (event: DragEvent) => {
            event.preventDefault();
            if (dragging !== null) move(dragging, index);
            setDragging(null);
          },
        }
      : {};

  const rowAlert = (row: InlineRow) => {
    const messages = Object.entries(errors?.rows[row.key] ?? {}).filter(([path]) => !fields.some((field) => field.name === path.split('.')[0]));
    return messages.length > 0 ? <p className="text-sm text-destructive">{messages.map(([path, list]) => `${path}: ${list.join(', ')}`).join(' — ')}</p> : null;
  };
  const showControls = ordered || rows.some(canRemove);

  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col rounded-card border bg-card shadow-card" data-inline={child.name}>
      <div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-5 py-3">
        <h2 id={titleId} className="text-[15px] font-semibold">
          {inline.label}
        </h2>
        <span className="inline-flex h-5 items-center rounded-full bg-muted px-2 text-[11px] text-muted-foreground">{limits(t, inline, rows.length)}</span>
        {canCreate && (
          <Button type="button" variant="outline" size="sm" className="ms-auto" onClick={add}>
            <Plus />
            {t('form.add', { name: inline.label })}
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-3 p-5 empty:hidden">
      {truncated && (
        <p role="note" className="text-sm text-muted-foreground">
          {t('inline.truncated', { count: truncated.total - rows.length })}{' '}
          <Link to={truncated.href} className="text-primary hover:underline">
            {t('inline.openList')}
          </Link>
        </p>
      )}
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{t('inline.empty')}</p>}
      {rows.length > 0 && inline.display === 'table' && (
        // Flush with the card's edges, like a list table; phones scroll it sideways, the page itself never does.
        <div className="relative -mx-5 overflow-x-auto border-y first:-mt-5 first:border-t-0 last:-mb-5 last:border-b-0">
          <table className="w-full text-[13px]">
            <thead className="bg-[color-mix(in_oklab,var(--muted)_50%,transparent)] text-[12.5px] text-muted-foreground">
              <tr>
                {(inline.computed ?? []).map((key) => (
                  <th key={`~${key}`} scope="col" className="px-3.5 py-2.5 text-start font-medium whitespace-nowrap">
                    {child.list.computed?.[key]?.label}
                  </th>
                ))}
                {fields.map((field) => (
                  <th key={field.name} scope="col" className="px-3.5 py-2.5 text-start font-medium whitespace-nowrap">
                    {field.label}
                    {child.form.requiredOnCreate.includes(field.name) && rows.some((row) => row.id === undefined) && (
                      <span aria-hidden className="text-destructive">
                        *
                      </span>
                    )}
                  </th>
                ))}
                {showControls && (
                  <th scope="col" className="px-3.5 py-2.5">
                    <span className="sr-only">{t('inline.rowActions')}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.key} data-row={row.key} className={cn('border-t align-top', dragging === index && 'opacity-50')} {...dropTarget(index)}>
                  {(inline.computed ?? []).map((key) => (
                    <td key={`~${key}`} className="px-3.5 py-2">
                      {row.record && child.list.computed?.[key] && <ComputedCell schema={child} name={key} column={child.list.computed[key]!} item={row.record} />}
                    </td>
                  ))}
                  {fields.map((field) => (
                    <td key={field.name} className="min-w-32 px-3.5 py-2">
                      {cell(row, field, true)}
                    </td>
                  ))}
                  {showControls && <td className="px-3.5 py-2">{controls(row, index)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {inline.display === 'table' && rows.map((row) => <Fragment key={row.key}>{rowAlert(row)}</Fragment>)}
      {inline.display === 'cards' &&
        rows.map((row, index) => (
          <div key={row.key} data-row={row.key} className={cn('flex flex-col gap-4 rounded-card border bg-background/40 p-4', dragging === index && 'opacity-50')} {...dropTarget(index)}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-medium">
                {titleOf(row) ?? t('inline.newRow', { name: inline.label, index: index + 1 })}
                {/* The first card by `order` (the main picture). */}
                {index === 0 && inline.markFirst && <Badge tone="primary">{inline.markFirst}</Badge>}
              </span>
              {controls(row, index)}
            </div>
            <FormLayout
              plain
              layout={child.form.layout}
              names={fields.map((field) => field.name)}
              errors={errors?.rows[row.key] ?? {}}
              render={(name) => {
                const field = fields.find((candidate) => candidate.name === name);
                return field ? cell(row, field, false) : null;
              }}
            />
            {rowAlert(row)}
          </div>
        ))}
      {errors && errors.inline.length > 0 && (
        <p role="alert" className="text-sm text-destructive">
          {errors.inline.join(' — ')}
        </p>
      )}
      </div>
    </section>
  );
}

const titleOf = (row: InlineRow): string | undefined => (typeof row.record?._title === 'string' ? row.record._title : undefined);

/** "2–10 rows", "at most 100": what a save may leave. */
function limits(t: ReturnType<typeof useT>, inline: FormLayoutInline, count: number): string {
  return inline.min ? t('inline.limitsBetween', { min: inline.min, max: inline.max, count }) : t('inline.limitsMax', { max: inline.max, count });
}

import type { AdminRecord, AsideCardSchema, ComputedValue, FieldSchema, FormLayoutNode, FormLayoutSummary, ResourceSchema } from '@nest-my-admin/core/contract';
import { cellModel } from '@/lib/computed-cells';
import { formatCell } from '@/lib/format';

/** The fields a layout shows (sections in tabs included); without a layout, the form's own. */
export function layoutFields(schema: ResourceSchema): string[] {
  const layout = schema.form.layout;
  if (!layout) return [...new Set([...schema.form.update, ...schema.form.readonly])];
  const sections = layout.flatMap((node: FormLayoutNode) => ('tab' in node ? node.sections : [node]));
  return sections.flatMap((node) => ('fields' in node && !('inline' in node) ? node.fields : []));
}

/**
 * Read-only fields an aside card or a summary already shows: the form leaves them out of its last section of
 * «everything else», so they appear once. Fields the user may change still get their input there.
 */
export function shownBesideMain(schema: ResourceSchema): Set<string> {
  const sections = (schema.form.layout ?? []).flatMap((node: FormLayoutNode) => ('tab' in node ? node.sections : [node]));
  const summaries = sections.flatMap((node) => ('summary' in node ? node.summary.flatMap((row) => ('field' in row.value ? [row.value.field] : [])) : []));
  const cards = (schema.form.aside ?? []).flatMap((card) => (card.relation ? [] : card.fields));
  const editable = new Set(schema.form.update);
  return new Set([...summaries, ...cards].filter((name) => !editable.has(name)));
}

/**
 * What the record page shows (spec §5.6): which fields are inputs (none in view mode until «Edit»; then the update
 * form's fields the layout shows), the header's badges and subtitle, and the aside cards.
 */
export function layoutModel(schema: ResourceSchema, record: AdminRecord | undefined, editing: boolean): {
  editable: string[];
  header: { badges: FieldSchema[]; subtitle: string[]; stepper?: FieldSchema };
  aside: AsideCardSchema[];
} {
  const viewing = schema.form.mode === 'view' && record !== undefined && !editing;
  const shown = new Set(layoutFields(schema));
  const editable = viewing ? [] : schema.form.update.filter((name) => shown.has(name) || !schema.form.layout);
  const header = schema.form.header;
  const field = (name: string) => schema.fields.find((candidate) => candidate.name === name);
  const present = (candidate: FieldSchema | undefined): candidate is FieldSchema => candidate !== undefined && record?.[candidate.name] !== undefined && record?.[candidate.name] !== null;
  const badges = (header?.badges ? header.badges.map(field) : schema.fields.filter((candidate) => candidate.widget === 'badge')).filter(present);
  // A stepper whose value is not a step (cancelled) says so in the header instead.
  const stepper = header?.stepper ? field(header.stepper) : undefined;
  if (stepper && present(stepper) && stepper.steps?.exclude.includes(String(record![stepper.name])) && !badges.includes(stepper)) badges.push(stepper);
  const computed = (record?._computed ?? {}) as Record<string, ComputedValue>;
  const subtitle = (header?.subtitle ?? []).flatMap((item) => {
    if ('field' in item) {
      const of = field(item.field);
      return of && present(of) ? [formatCell(record![of.name], of)] : [];
    }
    const column = schema.list.computed?.[item.computed];
    if (!column || !computed[item.computed]) return [];
    const model = cellModel(column, computed[item.computed]);
    return model.text ? [column.kind === 'count' ? `${model.text} ${column.label}` : model.text] : [];
  });
  return { editable, header: { badges, subtitle, ...(stepper ? { stepper } : {}) }, aside: schema.form.aside ?? [] };
}

/** A card's rows: the record's own fields, or a relation card's from `_aside` (absent when the user may not see it). */
export function asideValues(card: AsideCardSchema, index: number, record: AdminRecord | undefined): AdminRecord | undefined {
  if (!card.relation) return record;
  return (record?._aside as Record<string, AdminRecord> | undefined)?.[String(index)];
}

/** A summary card's rows (an order's totals): each label with its value formatted, rows without a value left out. */
export function summaryRows(node: Pick<FormLayoutSummary, 'summary'>, schema: ResourceSchema, record: AdminRecord | undefined): Array<{ label: string; text: string }> {
  const computed = (record?._computed ?? {}) as Record<string, ComputedValue>;
  return node.summary.flatMap((row) => {
    if ('field' in row.value) {
      const field = schema.fields.find((candidate) => candidate.name === (row.value as { field: string }).field);
      const value = record?.[row.value.field];
      return field && value !== undefined && value !== null ? [{ label: row.label, text: formatCell(value, field) }] : [];
    }
    const column = schema.list.computed?.[row.value.computed];
    const cell = computed[row.value.computed];
    if (!column || !cell) return [];
    const model = cellModel(column, cell);
    const text = model.unit ? (model.unitPosition === 'before' ? `${model.unit} ${model.text}` : `${model.text} ${model.unit}`) : model.text;
    return text ? [{ label: row.label, text }] : [];
  });
}

/** Soft warnings (`warnIf`) of the fields whose value is empty: shown under the input, never blocking a save. */
export function fieldWarnings(fields: FieldSchema[], values: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    if (!field.warnIf || !(field.name in values)) continue;
    const value = values[field.name];
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) out[field.name] = field.warnIf.message;
  }
  return out;
}

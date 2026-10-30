import type { EntityMetadata } from 'typeorm';
import type { FormLayoutInline } from '../contract.js';
import { resolveText, type LocalizedText } from '../i18n/localized-text.js';
import type { RegisteredResource, RelationMetadataLike } from '../registry/resource-registry.js';
import { DEFAULT_INLINE_MAX, layoutInlines, localizeLayout, mainLayout, type LayoutInlineConfig } from '../schema/field-config.js';
import { isToOne } from '../schema/relation-fields.js';
import { didYouMean } from '../schema/suggest.js';
import { bootText, type ScopedText } from '../i18n/texts.js';

/** An inline of a parent resource, resolved at boot against the child resource. */
export interface RegisteredInline {
  /** The child resource's name: the key in `ResourceSchema.inlines` and `_inlines`. */
  name: string;
  child: RegisteredResource;
  /** The child's field that points at the parent (`productId`, or `product` without an explicit column). */
  link: string;
  /** The child's relation behind `link`. */
  relation: RelationMetadataLike;
  /** The parent's property the link holds (the relation's referenced column, normally the primary key). */
  referenced: string;
  display: 'cards' | 'table';
  /** The child's fields the inline shows, in order (never `link`). */
  fields: string[];
  order?: string;
  min?: number;
  max: number;
  /** The section's title as configured (the child's label when absent). */
  label?: LocalizedText;
  /** The layout node it was declared by. */
  node: LayoutInlineConfig;
  readonly: boolean;
  /** The child's `list.computed` keys shown in the table. */
  computed: string[];
}

/**
 * Resolves the inline nodes of every resource's layout, once every resource is registered (a child may be registered
 * after its parent): the child resource, its link field, `order` and `fields`. Sets `entry.inlines` and puts the
 * resolved nodes into `entry.schema.form.layout` (texts in the first language given, like the rest of the schema).
 */
export function resolveInlines(entries: RegisteredResource[]): void {
  for (const entry of entries) {
    const layout = mainLayout(entry.resource.form?.layout);
    const nodes = layoutInlines(layout);
    if (!layout || nodes.length === 0) continue;
    const fail = (message: string): never => {
      throw new Error(`${entry.className}: ${message}`);
    };
    const inlines: RegisteredInline[] = [];
    for (const node of nodes) {
      const inline = resolveInline(entry, node, entries, fail);
      if (inlines.some((other) => other.name === inline.name)) fail(`form.layout inline ${node.inline.name} is placed twice; a child is inlined once per parent`);
      inlines.push(inline);
    }
    entry.inlines = inlines;
    entry.schema.form.layout = localizeLayout(layout, bootText, (node, label) => toLayoutInline(inlineOf(entry, node), label, bootText, bootText(inlineOf(entry, node).child.label)));
  }
}

/** The resolved inline of a layout node. */
export function inlineOf(entry: RegisteredResource, node: LayoutInlineConfig): RegisteredInline {
  const inline = entry.inlines.find((candidate) => candidate.node === node);
  if (!inline) throw new Error(`${entry.className}: an inline of the layout was not resolved`);
  return inline;
}

/**
 * The inline node the UI gets: `label` is the section's title already resolved, else `childLabel` (the child
 * resource's label); `text` resolves the parent's texts (`form.<key>.markFirst`).
 */
export function toLayoutInline(inline: RegisteredInline, label: string | undefined, text: ScopedText, childLabel: string): FormLayoutInline {
  return {
    inline: inline.name,
    label: label ?? childLabel,
    display: inline.display,
    fields: [...inline.fields],
    ...(inline.order !== undefined ? { order: inline.order } : {}),
    ...(inline.min !== undefined ? { min: inline.min } : {}),
    max: inline.max,
    link: inline.link,
    ...(inline.readonly ? { readonly: true as const } : {}),
    ...(inline.computed.length > 0 ? { computed: [...inline.computed] } : {}),
    ...(inline.node.cards?.markFirst !== undefined ? { markFirst: text(inline.node.cards.markFirst, inline.node.key === undefined ? undefined : `form.${inline.node.key}.markFirst`) } : {}),
  };
}

function resolveInline(entry: RegisteredResource, node: LayoutInlineConfig, entries: RegisteredResource[], fail: (message: string) => never): RegisteredInline {
  const where = `form.layout inline ${node.inline.name}`;
  const child = entries.find((candidate) => candidate.resource.constructor === node.inline);
  if (!child) return fail(`${where}: not a registered admin resource (add it to a module's providers)`);
  if (child.dataSource !== entry.dataSource) fail(`${where}: ${child.className} is on another DataSource; a parent and its inlines are saved in one transaction`);
  // A link holds one value: the parent's key (relations to composite keys are not fields either).
  if (entry.schema.primaryKeys.length !== 1) fail(`${where}: inlines need a parent with a single-column primary key`);
  if (layoutInlines(mainLayout(child.resource.form?.layout)).length > 0) fail(`${where}: ${child.className} declares inlines itself; inlines are one level deep`);
  const childName = entityName(child.metadata);
  const parentName = entityName(entry.metadata);

  // The child's to-one relation fields that point at the parent: its entity, or the root of its single-table family.
  const candidates = [...child.relations].filter(([, relation]) => isToOne(relation) && pointsAt(entry.metadata, relation.inverseEntityMetadata));
  if (candidates.length === 0) fail(`${where}: ${childName} has no many-to-one or owning one-to-one relation to ${parentName}`);
  const names = candidates.map(([name]) => name);
  let link: string;
  if (node.link !== undefined) {
    if (!names.includes(node.link)) fail(`${where}: link: "${node.link}" is not a relation of ${childName} to ${parentName} (use ${names.join(' or ')})`);
    link = node.link;
  } else {
    if (candidates.length > 1) fail(`${where}: ${childName} has several relations to ${parentName} (${names.join(', ')}); name the one that links it with \`link\``);
    link = names[0]!;
  }
  const relation = child.relations.get(link)!;

  const fieldOf = (name: string) => child.schema.fields.find((field) => field.name === name);
  if (node.order !== undefined && (fieldOf(node.order)?.type !== 'number' || node.order === link)) fail(`${where}: order: "${node.order}" is not a number field of ${childName}`);
  // Positions are written one row at a time, through the child's own update (hooks, audit): two rows would hold the
  // same position for a moment, which a unique index refuses. Moving rows through temporary positions instead would
  // show those positions to hooks and record them in the audit log.
  if (node.order !== undefined) {
    const unique = [...child.metadata.uniques, ...child.metadata.indices.filter((index) => index.isUnique)].find((constraint) => constraint.columns.some((column) => column.propertyName === node.order));
    if (unique) fail(`${where}: order: "${node.order}" is in a unique index or constraint (${unique.name}); positions are rewritten one row at a time, so they cannot be unique`);
  }

  const formNames = [...new Set([...child.schema.form.create, ...child.schema.form.update, ...child.schema.form.readonly])];
  for (const name of node.fields ?? []) {
    if (name === link) fail(`${where}: fields: "${name}" is the link field; the inline sets it`);
    if (!formNames.includes(name)) fail(`${where}: fields: "${name}" is not on the ${childName} form${didYouMean(name, formNames)}`);
  }
  for (const key of node.computed ?? []) if (!child.computed.has(key)) fail(`${where}: computed: "${key}" is not a list.computed column of ${childName}${didYouMean(key, [...child.computed.keys()])}`);
  const referenced = (relation.joinColumns[0] as { referencedColumn?: { propertyName: string } }).referencedColumn?.propertyName ?? entry.schema.primaryKeys[0]!;
  return {
    name: child.schema.name,
    child,
    link,
    relation,
    referenced,
    display: node.display ?? 'cards',
    fields: node.fields ? [...node.fields] : child.schema.form.update.filter((name) => name !== link),
    ...(node.order !== undefined ? { order: node.order } : {}),
    ...(node.min !== undefined ? { min: node.min } : {}),
    max: node.max ?? DEFAULT_INLINE_MAX,
    ...(node.section !== undefined ? { label: node.section } : {}),
    node,
    readonly: node.readonly === true,
    computed: [...(node.computed ?? [])],
  };
}

/**
 * Whether a relation to `target` can hold the parent's id: the parent's own entity, or, for a child of a single-table
 * family, an entity it inherits from in that table (a Variant of any Product is a Variant of a Shirt). A relation to a
 * kind of the parent (Shirt, when the parent is Product) is not: most parents could never have such children.
 */
function pointsAt(parent: EntityMetadata, target: { target: Function | string }): boolean {
  for (let current: EntityMetadata | undefined = parent; current; current = current.tableType === 'entity-child' ? current.parentEntityMetadata : undefined) {
    if (current.target === target.target) return true;
  }
  return false;
}

function entityName(metadata: EntityMetadata): string {
  return typeof metadata.target === 'function' ? metadata.target.name : metadata.name;
}

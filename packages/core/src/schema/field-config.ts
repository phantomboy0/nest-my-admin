import type { FieldSchema, FieldType, FormLayoutInline, FormLayoutNode, FormLayoutSection } from '../contract.js';
import { BADGE_COLORS, WIDGETS, getAdminFieldOptions, type AdminFieldOptions, type WidgetName } from '../decorators/admin-field.js';
import { resolveText, type LocalizedText } from '../i18n/localized-text.js';
import type { AdminResourceBase } from '../resource/admin-resource-base.js';
import { didYouMean } from './suggest.js';

/** A resource's `fields` entry: the static options plus `readonlyIf`, evaluated on the server per record. */
export interface FieldConfig<T = any> extends AdminFieldOptions {
  /** Locks the field on records where it returns true: shown read-only, and a PATCH that changes it is a 422. */
  readonlyIf?: (record: T) => boolean;
}

export type FieldsConfig<T> = { [K in Extract<keyof T, string>]?: FieldConfig<T> } & Record<string, FieldConfig<T> | undefined>;

/** `form.layout`: sections (optionally grouped into tabs). */
export interface LayoutSectionConfig {
  section?: LocalizedText;
  fields: string[];
  /** Columns on wide screens (one on phones). Default 1. */
  columns?: 1 | 2 | 3;
}
/** Default and hard cap of `max` on an inline. */
export const DEFAULT_INLINE_MAX = 100;
export const MAX_INLINE_ROWS = 500;

/**
 * A child resource edited inside the parent's form (Django's inlines): its records whose link points at the parent,
 * as a table or as cards. The child is an ordinary resource with its own permissions, scopes, fields and services.
 */
export interface LayoutInlineConfig {
  /** The section's title. Default: the child resource's label. */
  section?: LocalizedText;
  /**
   * The child resource class. Its entity must have one many-to-one (or owning one-to-one) relation to the parent's
   * entity (or to the root of its single-table family); name it with `link` when it has several.
   */
  inline: abstract new (...args: any[]) => AdminResourceBase<any>;
  /** The child's field that points at the parent (`productId`), when there are several candidates. */
  link?: string;
  /** `cards` (default): stacked cards with the child's form layout; `table`: one row per child, one cell per field. */
  display?: 'cards' | 'table';
  /** Which of the child's form fields the inline shows, in order. Default: its update form fields but the link. */
  fields?: string[];
  /** A number field of the child: rows are read by it (then by key) and reordering writes 0, 1, 2… into it. */
  order?: string;
  /** Fewest rows a save may leave. */
  min?: number;
  /** Most rows a save may leave and the form edits (default 100, at most 500). */
  max?: number;
}

export interface LayoutTabConfig {
  tab: LocalizedText;
  sections: Array<LayoutSectionConfig | LayoutInlineConfig>;
}
export type LayoutConfig = Array<LayoutSectionConfig | LayoutTabConfig | LayoutInlineConfig>;

export function isInlineConfig(node: LayoutSectionConfig | LayoutTabConfig | LayoutInlineConfig): node is LayoutInlineConfig {
  return 'inline' in node;
}

/** Every inline node of a layout, tabs included, in layout order. */
export function layoutInlines(layout: LayoutConfig | undefined): LayoutInlineConfig[] {
  return (layout ?? []).flatMap((node) => ('tab' in node ? node.sections : [node])).filter(isInlineConfig);
}

/** Field types each widget can edit or show. */
const WIDGET_TYPES: Record<WidgetName, readonly FieldType[]> = {
  text: ['string', 'text', 'uuid', 'other'],
  textarea: ['string', 'text'],
  number: ['number'],
  money: ['decimal', 'number', 'bigint'],
  switch: ['boolean'],
  checkbox: ['boolean'],
  select: ['enum'],
  radio: ['enum'],
  date: ['date'],
  datetime: ['datetime'],
  json: ['json', 'object'],
  color: ['string'],
  badge: ['enum', 'string', 'boolean'],
  slug: ['string'],
  password: ['string'],
  email: ['string'],
  url: ['string'],
  file: ['string', 'text', 'json'],
  image: ['string', 'text', 'json'],
  richtext: ['string', 'text'],
};

/** Default for `files.maxBytes`: 10 MiB. */
export const DEFAULT_MAX_FILE_BYTES = 10_485_760;

/** The largest `maxBytes` (module or field): `nma_file.size` is an `int` column. */
export const MAX_FILE_BYTES = 2_147_483_647;

/**
 * The options of each field, merged in spec §5.3 order: `@AdminField` on the entity, then on the create and update
 * DTOs, then the resource's `fields` config (later layers win, option by option).
 */
export function mergeFieldConfig(sources: Array<Function | undefined>, resourceFields: Record<string, FieldConfig | undefined> | undefined): Map<string, FieldConfig> {
  const merged = new Map<string, FieldConfig>();
  const add = (name: string, options: FieldConfig | undefined) => {
    if (options) merged.set(name, { ...merged.get(name), ...options });
  };
  for (const source of sources) for (const [name, options] of Object.entries(getAdminFieldOptions(source))) add(name, options);
  for (const [name, options] of Object.entries(resourceFields ?? {})) add(name, options);
  return merged;
}

/**
 * A primary key named `id` without a label of its own gets the built-in one: its humanized name ("Id") as before,
 * and "شناسه" in Persian.
 */
export function withIdLabel(fields: FieldSchema[], config: Map<string, FieldConfig>): Map<string, FieldConfig> {
  const id = fields.find((field) => field.name === 'id' && field.primary);
  if (id && config.get('id')?.label === undefined) config.set('id', { ...config.get('id'), label: { en: id.label, fa: 'شناسه' } });
  return config;
}

/** Widgets a `secret` field can use: anything else would show, upload or format its value. */
const SECRET_WIDGETS: readonly WidgetName[] = ['text', 'password'];

/**
 * Boot-time checks: known fields, widgets that fit, and references (`showIf`, `slugFrom`) to real fields.
 * `secret` is refused unless `allow.secrets` (the form of a settings page).
 */
export function checkFieldConfig(fields: FieldSchema[], config: Map<string, FieldConfig>, fail: (message: string) => never, allow: { secrets?: boolean } = {}): void {
  const names = fields.map((field) => field.name);
  for (const [name, options] of config) {
    const field = fields.find((candidate) => candidate.name === name);
    if (!field) fail(`fields: unknown field "${name}"${didYouMean(name, names)}`);
    if (options.widget !== undefined) {
      if (!WIDGETS.includes(options.widget)) fail(`fields.${name}: unknown widget "${options.widget}"${didYouMean(options.widget, WIDGETS)}`);
      if (!WIDGET_TYPES[options.widget].includes(field!.type)) fail(`fields.${name}: the "${options.widget}" widget does not fit ${field!.type} fields`);
    }
    checkFileOptions(name, field!, options, fail);
    if (options.secret) {
      if (!allow.secrets) fail(`fields.${name}: \`secret\` is for the fields of a settings page (@AdminSettingsPage)`);
      if (field!.type !== 'string' && field!.type !== 'text') fail(`fields.${name}: a \`secret\` field must be text, got ${field!.type}`);
      if (options.widget !== undefined && !SECRET_WIDGETS.includes(options.widget)) fail(`fields.${name}: a \`secret\` field cannot use the "${options.widget}" widget`);
    }
    if (options.sensitive !== undefined && typeof options.sensitive !== 'boolean') fail(`fields.${name}.sensitive: must be true or false`);
    for (const color of Object.values(options.colors ?? {})) {
      if (!BADGE_COLORS.includes(color)) fail(`fields.${name}: unknown badge colour "${color}" (use ${BADGE_COLORS.join(', ')})`);
    }
    for (const other of Object.keys(options.showIf ?? {})) {
      if (!names.includes(other)) fail(`fields.${name}.showIf: unknown field "${other}"${didYouMean(other, names)}`);
    }
    if (options.slugFrom !== undefined && !names.includes(options.slugFrom)) {
      fail(`fields.${name}.slugFrom: unknown field "${options.slugFrom}"${didYouMean(options.slugFrom, names)}`);
    }
    if (options.enumLabels && field!.enumValues) {
      for (const value of Object.keys(options.enumLabels)) {
        if (!field!.enumValues.includes(value)) fail(`fields.${name}.enumLabels: "${value}" is not one of ${field!.enumValues.join(', ')}`);
      }
    }
  }
}

function checkFileOptions(name: string, field: FieldSchema, options: FieldConfig, fail: (message: string) => never): void {
  const isFile = options.widget === 'file' || options.widget === 'image';
  if (options.file !== undefined) {
    if (!isFile && options.widget !== 'richtext') fail(`fields.${name}: \`file\` options need the "file", "image" or "richtext" widget`);
    const { accept, maxBytes, visibility } = options.file;
    if (accept !== undefined && options.widget === 'richtext') fail(`fields.${name}.file.accept: the images of a "richtext" field are always image/*`);
    if (accept !== undefined && (!Array.isArray(accept) || accept.some((type) => typeof type !== 'string' || !/^(\*\/\*|\*|[a-z0-9.+-]+\/(\*|[a-z0-9.+-]+))$/i.test(type.trim())))) {
      fail(`fields.${name}.file.accept: use types such as "image/*" or "application/pdf"`);
    }
    if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)) fail(`fields.${name}.file.maxBytes: must be a positive number of bytes`);
    if (maxBytes !== undefined && maxBytes > MAX_FILE_BYTES) fail(`fields.${name}.file.maxBytes: must be at most ${MAX_FILE_BYTES} bytes (2 GiB - 1)`);
    if (visibility !== undefined && visibility !== 'public' && visibility !== 'private') fail(`fields.${name}.file.visibility: must be "public" or "private"`);
  }
  if (options.many !== undefined) {
    if (!isFile) fail(`fields.${name}: \`many\` needs the "file" or "image" widget`);
    if (options.many && field.type !== 'json') fail(`fields.${name}: \`many\` needs a json column (simple-json or json) holding the list of files, got ${field.type}`);
  }
}

/** Fields whose values the audit log never stores: `sensitive`, `secret`, and anything typed into a `password` widget. */
export function sensitiveFields(config: ReadonlyMap<string, FieldConfig>): Set<string> {
  return new Set([...config].filter(([, options]) => options.sensitive === true || options.secret === true || options.widget === 'password').map(([name]) => name));
}

/** The field with its configured options, texts in `locale` (the schema the UI gets). */
export function applyFieldConfig(field: FieldSchema, options: FieldConfig | undefined, locale: string, defaultLocale: string, defaultMaxBytes = DEFAULT_MAX_FILE_BYTES, filesEnabled = false): FieldSchema {
  if (!options) return field;
  const text = (value: LocalizedText) => resolveText(value, locale, defaultLocale);
  const out: FieldSchema = { ...field };
  if (options.label !== undefined) out.label = text(options.label);
  if (options.help !== undefined) out.help = text(options.help);
  if (options.placeholder !== undefined) out.placeholder = text(options.placeholder);
  if (options.widget !== undefined) out.widget = options.widget;
  if (options.enumLabels) out.enumLabels = Object.fromEntries(Object.entries(options.enumLabels).map(([value, label]) => [value, text(label)]));
  if (options.colors) out.colors = { ...options.colors };
  if (options.showIf) out.showIf = { ...options.showIf };
  if (options.slugFrom !== undefined) out.slugFrom = options.slugFrom;
  if (options.currency !== undefined) out.currency = options.currency;
  if (options.widget === 'file' || options.widget === 'image') {
    out.file = {
      accept: [...(options.file?.accept ?? (options.widget === 'image' ? ['image/*'] : ['*/*']))],
      maxBytes: options.file?.maxBytes ?? defaultMaxBytes,
      many: options.many === true,
    };
  }
  if (options.secret) out.secret = true;
  if (options.widget === 'richtext') out.richtext = { images: filesEnabled, maxBytes: options.file?.maxBytes ?? defaultMaxBytes };
  return out;
}

/**
 * Every layout name is a form field, listed once. Inline nodes (only where `allow.inlines`: a resource's form) are
 * checked for their shape here; the registry resolves them against the child once every resource is known.
 */
export function checkLayout(layout: LayoutConfig, formNames: string[], fail: (message: string) => never, allow: { inlines?: boolean } = {}): void {
  const seen = new Set<string>();
  const nodes = layout.flatMap((node) => ('tab' in node ? node.sections : [node]));
  for (const node of nodes) {
    if (isInlineConfig(node)) {
      if (!allow.inlines) fail('form.layout: inlines belong in the form of a resource');
      checkInlineShape(node, fail);
      continue;
    }
    const section = node;
    if (section.columns !== undefined && ![1, 2, 3].includes(section.columns)) fail('form.layout: columns must be 1, 2 or 3');
    for (const name of section.fields) {
      if (!formNames.includes(name)) fail(`form.layout: "${name}" is not on the form${didYouMean(name, formNames)}`);
      if (seen.has(name)) fail(`form.layout: "${name}" is listed twice`);
      seen.add(name);
    }
  }
}

const isFieldName = (value: unknown) => typeof value === 'string' && value.length > 0;

/** The options of an inline node that need no other resource to check. */
function checkInlineShape(node: LayoutInlineConfig, fail: (message: string) => never): void {
  if (typeof node.inline !== 'function') fail('form.layout: `inline` must be a resource class (`inline: VariantAdmin`)');
  const where = `form.layout inline ${node.inline.name}`;
  if (node.display !== undefined && node.display !== 'cards' && node.display !== 'table') fail(`${where}: display must be "cards" or "table"`);
  const max = node.max ?? DEFAULT_INLINE_MAX;
  if (!Number.isInteger(max) || max < 1 || max > MAX_INLINE_ROWS) fail(`${where}: max: must be an integer from 1 to ${MAX_INLINE_ROWS}`);
  if (node.min !== undefined && (!Number.isInteger(node.min) || node.min < 0 || node.min > max)) fail(`${where}: min: must be an integer from 0 to max (${max})`);
  if (node.link !== undefined && !isFieldName(node.link)) fail(`${where}: link: must be a field name`);
  if (node.order !== undefined && !isFieldName(node.order)) fail(`${where}: order: must be a field name`);
  if (node.fields !== undefined) {
    if (!Array.isArray(node.fields) || node.fields.length === 0) fail(`${where}: fields: must list at least one field`);
    const listed = new Set<string>();
    for (const name of node.fields) {
      if (!isFieldName(name)) fail(`${where}: fields: must be field names`);
      if (listed.has(name)) fail(`${where}: fields: "${name}" is listed twice`);
      listed.add(name);
    }
  }
}

/**
 * The layout with texts in `locale`. `inline` turns an inline node into what the UI gets (given the section's title in
 * `locale`); nodes it answers `undefined` for are left out, and so is a tab left without sections by that.
 */
export function localizeLayout(
  layout: LayoutConfig,
  locale: string,
  defaultLocale: string,
  inline?: (node: LayoutInlineConfig, label: string | undefined) => FormLayoutInline | undefined,
): FormLayoutNode[] {
  const section = (node: LayoutSectionConfig | LayoutInlineConfig): FormLayoutSection | FormLayoutInline | undefined => {
    const title = node.section !== undefined ? resolveText(node.section, locale, defaultLocale) : undefined;
    if (isInlineConfig(node)) return inline?.(node, title);
    return { ...(title !== undefined ? { title } : {}), fields: [...node.fields], columns: node.columns ?? 1 };
  };
  const out: FormLayoutNode[] = [];
  for (const node of layout) {
    if ('tab' in node) {
      const sections = node.sections.map(section).filter((item) => item !== undefined);
      if (sections.length > 0 || node.sections.length === 0) out.push({ tab: resolveText(node.tab, locale, defaultLocale), sections });
    } else {
      const item = section(node);
      if (item) out.push(item);
    }
  }
  return out;
}

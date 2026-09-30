import type { FieldSchema, FieldType, FormLayoutNode, FormLayoutSection } from '../contract.js';
import { BADGE_COLORS, WIDGETS, getAdminFieldOptions, type AdminFieldOptions, type WidgetName } from '../decorators/admin-field.js';
import { resolveText, type LocalizedText } from '../i18n/localized-text.js';
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
export interface LayoutTabConfig {
  tab: LocalizedText;
  sections: LayoutSectionConfig[];
}
export type LayoutConfig = Array<LayoutSectionConfig | LayoutTabConfig>;

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
};

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

/** Boot-time checks: known fields, widgets that fit, and references (`showIf`, `slugFrom`) to real fields. */
export function checkFieldConfig(fields: FieldSchema[], config: Map<string, FieldConfig>, fail: (message: string) => never): void {
  const names = fields.map((field) => field.name);
  for (const [name, options] of config) {
    const field = fields.find((candidate) => candidate.name === name);
    if (!field) fail(`fields: unknown field "${name}"${didYouMean(name, names)}`);
    if (options.widget !== undefined) {
      if (!WIDGETS.includes(options.widget)) fail(`fields.${name}: unknown widget "${options.widget}"${didYouMean(options.widget, WIDGETS)}`);
      if (!WIDGET_TYPES[options.widget].includes(field!.type)) fail(`fields.${name}: the "${options.widget}" widget does not fit ${field!.type} fields`);
    }
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

/** The field with its configured options, texts in `locale` (the schema the UI gets). */
export function applyFieldConfig(field: FieldSchema, options: FieldConfig | undefined, locale: string, defaultLocale: string): FieldSchema {
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
  return out;
}

/** Every layout name is a form field, listed once. */
export function checkLayout(layout: LayoutConfig, formNames: string[], fail: (message: string) => never): void {
  const seen = new Set<string>();
  const sections = layout.flatMap((node) => ('tab' in node ? node.sections : [node]));
  for (const section of sections) {
    if (section.columns !== undefined && ![1, 2, 3].includes(section.columns)) fail('form.layout: columns must be 1, 2 or 3');
    for (const name of section.fields) {
      if (!formNames.includes(name)) fail(`form.layout: "${name}" is not on the form${didYouMean(name, formNames)}`);
      if (seen.has(name)) fail(`form.layout: "${name}" is listed twice`);
      seen.add(name);
    }
  }
}

export function localizeLayout(layout: LayoutConfig, locale: string, defaultLocale: string): FormLayoutNode[] {
  const section = (node: LayoutSectionConfig): FormLayoutSection => ({
    ...(node.section !== undefined ? { title: resolveText(node.section, locale, defaultLocale) } : {}),
    fields: [...node.fields],
    columns: node.columns ?? 1,
  });
  return layout.map((node) => ('tab' in node ? { tab: resolveText(node.tab, locale, defaultLocale), sections: node.sections.map(section) } : section(node)));
}

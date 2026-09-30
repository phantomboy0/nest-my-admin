import type { LocalizedText } from '../i18n/localized-text.js';
import { didYouMean } from '../schema/suggest.js';

/** A field rule of a role: `readonly` and `view` both mean "shown, not editable". */
export type FieldRule = 'hidden' | 'readonly' | 'view' | 'edit';
/** Operations a row scope can restrict. */
export type ScopedOperation = 'view' | 'update' | 'delete';
/** What a role can do with a resource (spec §6.1). `purge` removes trashed records for good. */
export const RESOURCE_OPERATIONS = ['view', 'create', 'update', 'delete', 'purge'] as const;
export type ResourceOperation = (typeof RESOURCE_OPERATIONS)[number];

/** A named bundle of permissions, field rules and row scopes (spec §6.1). */
export interface RoleDefinition {
  name: string;
  label?: LocalizedText;
  description?: LocalizedText;
  /**
   * Permission codes: `product.view`, `product.update`, `product.field.cost.view`, `product.view_all` (custom),
   * `reports.run` (global custom). Wildcards: `*` (everything), `product.*` (everything on product), `*.view`.
   */
  permissions: string[];
  /** Per resource, per field: `hidden`, `readonly` (= `view`) or `edit` (spec §6.2). */
  fields?: Record<string, Record<string, FieldRule>>;
  /** Per resource, per operation: the `@AdminScope` names that limit the rows (ORed); none = all rows. */
  scopes?: Record<string, Partial<Record<ScopedOperation, string | string[]>>>;
}

/** Whether `pattern` grants `code`: `*` as the last segment matches the rest, elsewhere exactly one segment. */
export function codeMatches(pattern: string, code: string): boolean {
  const wanted = pattern.split('.');
  const actual = code.split('.');
  for (let i = 0; i < wanted.length; i++) {
    const part = wanted[i]!;
    if (part === '*' && i === wanted.length - 1) return actual.length > i;
    if (i >= actual.length) return false;
    if (part !== '*' && part !== actual[i]) return false;
  }
  return wanted.length === actual.length;
}

/** What the roles are checked against: every resource's fields, scopes and custom codes. */
export interface PolicyCatalog {
  resources: Map<string, { fields: string[]; scopes: string[]; custom: string[]; restricted?: string[] }>;
  /** Codes declared in `forRoot({ permissions })`. */
  global: string[];
}

/** Every permission code that exists. */
export function knownCodes(catalog: PolicyCatalog): string[] {
  const codes = [...catalog.global];
  for (const [name, resource] of catalog.resources) {
    for (const op of RESOURCE_OPERATIONS) codes.push(`${name}.${op}`);
    for (const custom of resource.custom) codes.push(`${name}.${custom}`);
    for (const field of resource.fields) codes.push(`${name}.field.${field}.view`, `${name}.field.${field}.edit`);
  }
  return codes;
}

const FIELD_RULES: readonly FieldRule[] = ['hidden', 'readonly', 'view', 'edit'];
const SCOPED: readonly ScopedOperation[] = ['view', 'update', 'delete'];

/** Boot-time checks: every code, resource, field and scope a role names exists (spec §13.2). */
export function checkRoles(roles: RoleDefinition[], catalog: PolicyCatalog, fail: (message: string) => never): void {
  const codes = knownCodes(catalog);
  const resourceNames = [...catalog.resources.keys()];
  const seen = new Set<string>();
  for (const role of roles) {
    if (!role.name || !/^[a-z0-9][a-z0-9._-]*$/i.test(role.name)) fail(`roles: "${role.name}" is not a valid role name (letters, digits, . _ -)`);
    if (seen.has(role.name)) fail(`roles: "${role.name}" is defined twice`);
    seen.add(role.name);
    const where = `roles.${role.name}`;
    for (const pattern of role.permissions ?? []) {
      if (!codes.some((code) => codeMatches(pattern, code))) fail(`${where}.permissions: unknown permission "${pattern}"${didYouMean(pattern, codes)}`);
    }
    for (const [resource, rules] of Object.entries(role.fields ?? {})) {
      const known = catalog.resources.get(resource);
      if (!known) fail(`${where}.fields: unknown resource "${resource}"${didYouMean(resource, resourceNames)}`);
      for (const [field, rule] of Object.entries(rules)) {
        if (!known!.fields.includes(field)) fail(`${where}.fields.${resource}: unknown field "${field}"${didYouMean(field, known!.fields)}`);
        if (!FIELD_RULES.includes(rule)) fail(`${where}.fields.${resource}.${field}: "${rule}" is not hidden, readonly, view or edit`);
      }
    }
    for (const [resource, byOperation] of Object.entries(role.scopes ?? {})) {
      const known = catalog.resources.get(resource);
      if (!known) fail(`${where}.scopes: unknown resource "${resource}"${didYouMean(resource, resourceNames)}`);
      for (const [operation, names] of Object.entries(byOperation ?? {})) {
        if (!SCOPED.includes(operation as ScopedOperation)) fail(`${where}.scopes.${resource}: "${operation}" is not view, update or delete`);
        for (const scope of Array.isArray(names) ? names : [names]) {
          if (!known!.scopes.includes(scope as string)) {
            fail(`${where}.scopes.${resource}.${operation}: no @AdminScope("${scope}") on the ${resource} resource${didYouMean(String(scope), known!.scopes)}`);
          }
        }
      }
    }
  }
}

import type { FieldSchema } from '@nest-my-admin/core/contract';
import type { FormValues } from '@/lib/form-values';

const NAME = /\{([^{}]*)\}/g;

/** `{crm}.example.com` with `crm` = `acme` → `acme.example.com`; empty while any field it names is empty. */
export function fillTemplate(template: string, values: FormValues): string {
  let empty = false;
  const out = template.replace(NAME, (_, name: string) => {
    const value = values[name];
    const text = typeof value === 'string' ? value.trim() : typeof value === 'boolean' ? String(value) : '';
    if (text === '') empty = true;
    return text;
  });
  return empty ? '' : out;
}

/** Fields with `fillFrom` that start as typed: they already hold a value (a stored record, a duplicate). */
export function initiallyTyped(fields: FieldSchema[], values: FormValues): Set<string> {
  return new Set(fields.filter((field) => field.fillFrom !== undefined && values[field.name] !== '' && values[field.name] !== undefined).map((field) => field.name));
}

/**
 * `values` with every `fillFrom` field nobody typed in recomputed. Chains (`api.{domain}` where `domain` fills from
 * `{crm}`) settle in as many passes as the chain is long; the server refuses circles at boot.
 */
export function applyFills(fields: FieldSchema[], values: FormValues, typed: ReadonlySet<string>): FormValues {
  const filling = fields.filter((field) => field.fillFrom !== undefined && !typed.has(field.name));
  if (filling.length === 0) return values;
  let next = values;
  for (let pass = 0; pass <= filling.length; pass++) {
    let changed = false;
    for (const field of filling) {
      const value = fillTemplate(field.fillFrom!, next);
      if (next[field.name] !== value) {
        if (next === values) next = { ...values };
        next[field.name] = value;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return next;
}

/**
 * After someone edits `name`: a `fillFrom` field they typed in stops following, and one they emptied follows again.
 */
export function noteTyped(fields: FieldSchema[], typed: Set<string>, name: string, value: unknown): void {
  if (!fields.some((field) => field.name === name && field.fillFrom !== undefined)) return;
  if (value === '' || value === null) typed.delete(name);
  else typed.add(name);
}

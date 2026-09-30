import type { FieldSchema } from '@nest-my-admin/core/contract';
import { isRef, type FormValue, type FormValues } from '@/lib/form-values';

type Expected = string | number | boolean | null;

function matches(current: FormValue | undefined, expected: Expected): boolean {
  const value = isRef(current) ? String(current.id) : current;
  if (expected === null) return value === null || value === undefined || value === '';
  if (typeof expected === 'boolean') return value === expected || value === String(expected);
  if (typeof value !== 'string' || value.trim() === '') return false;
  if (typeof expected === 'number') return Number(value.trim().replace(/,/g, '')) === expected;
  return value === expected;
}

/**
 * Whether a field is shown for the form's current values: every `showIf` field must hold the value (or one of the
 * values) given. Values are compared as the form holds them (numbers typed as text, booleans as booleans).
 */
export function isShown(field: FieldSchema, values: FormValues): boolean {
  if (!field.showIf) return true;
  return Object.entries(field.showIf).every(([name, expected]) =>
    (Array.isArray(expected) ? expected : [expected]).some((option) => matches(values[name], option)),
  );
}

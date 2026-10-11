import type { FieldSchema, PageResponse, PageSchema } from '@nest-my-admin/core/contract';
import { toFormValues, toPayload, type FormValues, type PayloadResult } from '@/lib/form-values';
import { isShown } from '@/lib/show-if';
import { validatePayload } from '@/lib/validate';

/**
 * A settings page as form values. A secret is never served, so its input starts empty whatever is stored
 * (`PageResponse.secrets` says whether something is): `''` means "leave it alone", text replaces it, and `null`
 * (the Clear button) clears it.
 */
export function pageFormValues(page: PageResponse): FormValues {
  const values = toFormValues(page.schema.fields.filter((field) => !field.secret), { ...page.values, _files: page.files });
  for (const field of page.schema.fields) if (field.secret) values[field.name] = '';
  return values;
}

/**
 * What a save sends: only what changed since `initial` (a save is partial), without fields hidden by `showIf`.
 *
 * - A group of fields is sent whole once any of its fields changed: `save()` stores what it gets under the group's
 *   key, so a part would lose the rest.
 * - A secret is sent only as new text or as `null` (clear). An untouched one, an emptied one and one holding only
 *   spaces are left out: `''` is never sent, since "empty" means "unchanged" in the form.
 */
export function pagePayload(fields: FieldSchema[], values: FormValues, initial: FormValues): PayloadResult {
  const shown = fields.filter((field) => isShown(field, values));
  const plain = shown.filter((field) => !field.secret);
  const { payload, errors } = toPayload(plain, values, initial);
  const groups = plain.filter((field) => field.type === 'object' && !field.many && Object.hasOwn(payload, field.name));
  const whole = toPayload(groups, values);
  Object.assign(payload, whole.payload);
  Object.assign(errors, whole.errors);
  for (const field of shown) {
    if (!field.secret) continue;
    const raw = values[field.name];
    if (raw === null) payload[field.name] = null;
    else if (typeof raw === 'string' && raw.trim() !== '') payload[field.name] = raw;
  }
  return { payload, errors };
}

/**
 * Checks what a save sends, and only that: `schema.required` never refuses a save for a field that is not being
 * sent. A sent field must hold a value when the DTO requires one (the user emptied it), except a secret, which
 * `null` always clears. Inside a group (sent whole) every rule applies as on a new record.
 */
export function validatePagePayload(payload: Record<string, unknown>, schema: Pick<PageSchema, 'fields' | 'constraints'>): Record<string, string[]> {
  const secrets = new Set(schema.fields.filter((field) => field.secret).map((field) => field.name));
  const sent = Object.entries(schema.constraints).filter(([name]) => Object.hasOwn(payload, name.split('.')[0]!));
  const own = sent.filter(([name]) => !name.includes('.')).map(([name, rules]) => [name, secrets.has(name) ? { ...rules, required: false } : rules] as const);
  const nested = sent.filter(([name]) => name.includes('.'));
  return { ...validatePayload(payload, Object.fromEntries(nested), 'create'), ...validatePayload(payload, Object.fromEntries(own), 'update') };
}

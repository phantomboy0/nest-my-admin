import { ApiError } from '@/lib/api-error';

export interface ShownErrors {
  /** Messages for fields the form shows, by field path. */
  fields: Record<string, string[]>;
  /** What goes above the form: the error itself when no field explains it, plus messages of fields not on the form. */
  form: string | null;
}

/**
 * Where a failed write is shown: field errors next to their inputs (`address.city` belongs to `address`), everything
 * else in one line above the form. An error that every field explains needs no line of its own.
 */
export function shownErrors(error: Error, names: string[]): ShownErrors {
  if (!(error instanceof ApiError)) return { fields: {}, form: error.message };
  const entries = Object.entries(error.fields);
  const onForm = (name: string) => names.includes(name.split('.')[0]!);
  const fields = Object.fromEntries(entries.filter(([name]) => onForm(name)));
  const hidden = entries.filter(([name]) => !onForm(name)).map(([name, messages]) => `${name}: ${messages.join(', ')}`);
  return { fields, form: Object.keys(fields).length > 0 && hidden.length === 0 ? null : [error.message, ...hidden].join(' — ') };
}

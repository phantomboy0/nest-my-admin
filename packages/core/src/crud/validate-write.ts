import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { AdminBadRequestError, AdminValidationError } from '../errors.js';
import type { FieldSchema } from '../contract.js';
import type { DtoClass } from '../schema/dto-fields.js';

export interface WriteRules {
  /** Field names the client may send for this operation. */
  allowed: string[];
  /** DTO to validate with. Without one, only `allowed` is enforced. */
  dto?: DtoClass;
  /** Validate only the properties present in the body (PATCH reusing a create DTO). */
  partial?: boolean;
  /** The resource's fields: without a DTO, keys inside object fields are checked against their children. */
  fields?: FieldSchema[];
  /** Keep the values the DTO's class initializers give to properties the body leaves out (an action's input); writes drop them. */
  keepDefaults?: boolean;
  /** Cleans the HTML of `richtext` fields; sent values pass through it before anything else looks at them. Required when `fields` has one. */
  sanitizeHtml?: (html: string) => string;
  /** Properties the server sets itself (an inline's link): the DTO's errors on them are dropped. */
  ignore?: string[];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function checkObject(value: unknown, field: FieldSchema, path: string, errors: Record<string, string[]>): void {
  if (value === null) {
    if (!field.nullable) errors[path] = ['is required'];
    return;
  }
  if (field.many) {
    if (!Array.isArray(value)) errors[path] = ['must be a list'];
    else value.forEach((item, index) => checkGroup(item, field, `${path}.${index}`, errors));
    return;
  }
  checkGroup(value, field, path, errors);
}

function checkGroup(value: unknown, field: FieldSchema, path: string, errors: Record<string, string[]>): void {
  if (!isPlainObject(value)) {
    errors[path] = ['must be an object'];
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const schema = field.fields?.find((candidate) => candidate.name === key && !candidate.readonly);
    if (!schema) errors[`${path}.${key}`] = ['is not a writable field'];
    else if (schema.type === 'object') checkObject(child, schema, `${path}.${key}`, errors);
  }
}

/**
 * A partial update validates what was sent: errors on properties the body leaves out are dropped, inside objects too
 * (`{ address: { zip } }` does not need `address.city`). Lists are sent whole, so their items are validated whole.
 */
function prunePartial(errors: ValidationError[], input: Record<string, unknown>): ValidationError[] {
  const kept: ValidationError[] = [];
  for (const error of errors) {
    if (!Object.hasOwn(input, error.property)) continue;
    const value = input[error.property];
    if (error.children?.length && isPlainObject(value)) {
      error.children = prunePartial(error.children, value);
      if (!error.constraints && error.children.length === 0) continue;
    }
    kept.push(error);
  }
  return kept;
}

/** Most files one `many` field takes. */
const MAX_FILES = 100;

/** A file field's value: `{ token }` (a new upload), `{ key }` (keep this file) or null; a list of those for `many`. */
function checkFile(value: unknown, field: FieldSchema, errors: Record<string, string[]>): void {
  if (value === null) return;
  const one = (item: unknown): boolean => {
    if (!isPlainObject(item)) return false;
    const keys = Object.keys(item);
    if (keys.length !== 1 || (keys[0] !== 'token' && keys[0] !== 'key')) return false;
    const text = item[keys[0]];
    return typeof text === 'string' && text !== '' && text.length <= (keys[0] === 'token' ? 36 : 500);
  };
  if (field.file!.many) {
    if (!Array.isArray(value) || value.length > MAX_FILES || !value.every(one)) errors[field.name] = ['must be a list of uploaded files'];
  } else if (!one(value)) errors[field.name] = ['must be an uploaded file'];
}

export async function validateWrite(body: unknown, rules: WriteRules): Promise<object> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AdminBadRequestError('Request body must be a JSON object');
  }
  let input = body as Record<string, unknown>;

  const unknownKeys = Object.keys(input).filter((key) => !rules.allowed.includes(key));
  if (unknownKeys.length > 0) {
    throw new AdminValidationError(Object.fromEntries(unknownKeys.map((key) => [key, ['is not a writable field']])));
  }

  // File fields have their own shape, whatever the DTO says about the column (a string, or a list of them).
  const fileFields = (rules.fields ?? []).filter((field) => field.file !== undefined && Object.hasOwn(input, field.name));
  const fileErrors: Record<string, string[]> = {};
  for (const field of fileFields) checkFile(input[field.name], field, fileErrors);
  if (Object.keys(fileErrors).length > 0) throw new AdminValidationError(fileErrors);

  // Fails closed: without a sanitizer the HTML would be stored as sent. That is a caller's mistake, not the client's.
  const unsanitized = rules.sanitizeHtml ? undefined : (rules.fields ?? []).find((field) => field.widget === 'richtext');
  if (unsanitized) throw new Error(`nest-my-admin: validateWrite needs \`sanitizeHtml\` for the rich-text field "${unsanitized.name}"`);

  // Rich text is cleaned first, so the DTO's rules (length, ...) judge what will be stored.
  const richText = (rules.fields ?? []).filter((field) => field.widget === 'richtext' && Object.hasOwn(input, field.name) && input[field.name] !== null);
  if (richText.length > 0) {
    const sanitize = rules.sanitizeHtml!;
    const bad = richText.filter((field) => typeof input[field.name] !== 'string');
    if (bad.length > 0) throw new AdminValidationError(Object.fromEntries(bad.map((field) => [field.name, ['must be text']])));
    input = { ...input };
    for (const field of richText) input[field.name] = sanitize(input[field.name] as string);
  }

  if (!rules.dto) {
    const errors: Record<string, string[]> = {};
    for (const field of rules.fields ?? []) {
      if (field.type === 'object' && field.file === undefined && Object.hasOwn(input, field.name)) checkObject(input[field.name], field, field.name, errors);
    }
    if (Object.keys(errors).length > 0) throw new AdminValidationError(errors);
    return { ...input };
  }

  // The DTO validates the rest; a file that was sent satisfies whatever the DTO asks of its property.
  const sent = new Set(fileFields.filter((field) => input[field.name] !== null).map((field) => field.name));
  const plain = Object.fromEntries(Object.entries(input).filter(([key]) => !sent.has(key)));
  const instance = plainToInstance(rules.dto, plain);
  let errors = (await validate(instance, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true })).filter((error) => !sent.has(error.property));
  if (rules.partial) errors = prunePartial(errors, input);
  if (rules.ignore) errors = errors.filter((error) => !rules.ignore!.includes(error.property));
  if (errors.length > 0) throw new AdminValidationError(flattenValidationErrors(errors));
  for (const name of sent) (instance as Record<string, unknown>)[name] = input[name];
  // Constructor initializers add keys the client never sent; they would overwrite stored values on update.
  if (!rules.keepDefaults) {
    for (const key of Object.keys(instance)) {
      if (!Object.hasOwn(input, key)) delete (instance as Record<string, unknown>)[key];
    }
  }
  return instance;
}

export function flattenValidationErrors(errors: ValidationError[], prefix = ''): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const error of errors) {
    const key = prefix ? `${prefix}.${error.property}` : error.property;
    if (error.constraints) out[key] = Object.values(error.constraints);
    if (error.children?.length) Object.assign(out, flattenValidationErrors(error.children, key));
  }
  return out;
}

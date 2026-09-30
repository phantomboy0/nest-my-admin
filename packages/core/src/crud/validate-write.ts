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

export async function validateWrite(body: unknown, rules: WriteRules): Promise<object> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AdminBadRequestError('Request body must be a JSON object');
  }
  const input = body as Record<string, unknown>;

  const unknownKeys = Object.keys(input).filter((key) => !rules.allowed.includes(key));
  if (unknownKeys.length > 0) {
    throw new AdminValidationError(Object.fromEntries(unknownKeys.map((key) => [key, ['is not a writable field']])));
  }

  if (!rules.dto) {
    const errors: Record<string, string[]> = {};
    for (const field of rules.fields ?? []) {
      if (field.type === 'object' && Object.hasOwn(input, field.name)) checkObject(input[field.name], field, field.name, errors);
    }
    if (Object.keys(errors).length > 0) throw new AdminValidationError(errors);
    return { ...input };
  }

  const instance = plainToInstance(rules.dto, input);
  let errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true });
  if (rules.partial) errors = prunePartial(errors, input);
  if (errors.length > 0) throw new AdminValidationError(flattenValidationErrors(errors));
  // Constructor initializers add keys the client never sent; they would overwrite stored values on update.
  for (const key of Object.keys(instance)) {
    if (!Object.hasOwn(input, key)) delete (instance as Record<string, unknown>)[key];
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

import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { AdminBadRequestError, AdminValidationError } from '../errors.js';
import type { DtoClass } from '../schema/dto-fields.js';

export interface WriteRules {
  /** Field names the client may send for this operation. */
  allowed: string[];
  /** DTO to validate with. Without one, only `allowed` is enforced. */
  dto?: DtoClass;
  /** Validate only the properties present in the body (PATCH reusing a create DTO). */
  partial?: boolean;
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

  if (!rules.dto) return { ...input };

  const instance = plainToInstance(rules.dto, input);
  let errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true });
  if (rules.partial) errors = errors.filter((error) => Object.hasOwn(input, error.property));
  if (errors.length > 0) throw new AdminValidationError(flattenValidationErrors(errors));
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

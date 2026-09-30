import type { FieldConstraints } from '@nest-my-admin/core/contract';

const EMAIL = /^.+@[^\s@]+\.[^\s@]+$/; // the local part may be quoted, so it may hold spaces and @
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deliberately no stricter than class-validator's @IsUrl: a protocol is optional and any protocol is fine,
 * but the host needs a dot (or be an IPv6 literal), which the server also demands.
 */
function isUrl(value: string): boolean {
  if (/\s/.test(value)) return false;
  try {
    const { hostname } = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`);
    return hostname.includes('.') || hostname.startsWith('[');
  } catch {
    return false;
  }
}

function matchesPattern(value: string, pattern: NonNullable<FieldConstraints['pattern']>): boolean {
  try {
    return new RegExp(pattern.source, pattern.flags).test(value);
  } catch {
    return true; // a pattern this browser cannot compile is left to the server
  }
}

/** Length as validator's isLength counts it: surrogate pairs and emoji variation selectors are one character. */
function characterCount(value: string): number {
  const surrogatePairs = value.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g) ?? [];
  const presentation = value.match(/[^\uFE0F\uFE0E][\uFE0F\uFE0E]/g) ?? [];
  return value.length - surrogatePairs.length - presentation.length;
}

function check(value: unknown, c: FieldConstraints): string[] {
  const messages: string[] = [];
  if (typeof value === 'string') {
    const length = characterCount(value);
    if (c.minLength !== undefined && length < c.minLength) messages.push(`must be at least ${c.minLength} characters`);
    if (c.maxLength !== undefined && length > c.maxLength) messages.push(`must be at most ${c.maxLength} characters`);
    if (c.pattern && !matchesPattern(value, c.pattern)) messages.push(c.pattern.message ?? 'is not in the expected format');
    if (c.format === 'email' && !EMAIL.test(value)) messages.push('must be an email address');
    if (c.format === 'url' && !isUrl(value)) messages.push('must be a URL');
    if (c.format === 'uuid' && !UUID.test(value)) messages.push('must be a UUID');
    if (c.oneOf && !c.oneOf.includes(value)) messages.push(`must be one of: ${c.oneOf.join(', ')}`);
  }
  if (typeof value === 'number') {
    if (c.integer && !Number.isInteger(value)) messages.push('must be an integer');
    if (c.min !== undefined && value < c.min) messages.push(`must be at least ${c.min}`);
    if (c.max !== undefined && value > c.max) messages.push(`must be at most ${c.max}`);
  }
  return messages;
}

/**
 * Checks a payload (the output of toPayload) against the schema's constraints. The server re-validates;
 * this only saves a round trip, so it must never reject a value the server accepts.
 */
export function validatePayload(
  payload: Record<string, unknown>,
  constraints: Record<string, FieldConstraints>,
  mode: 'create' | 'update',
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const [name, c] of Object.entries(constraints)) {
    const sent = Object.hasOwn(payload, name);
    const value = payload[name];
    if (value === undefined || value === null || value === '') {
      if (c.required && (mode === 'create' || sent)) errors[name] = ['is required'];
      continue;
    }
    const messages = check(value, c);
    if (messages.length > 0) errors[name] = messages;
  }
  return errors;
}

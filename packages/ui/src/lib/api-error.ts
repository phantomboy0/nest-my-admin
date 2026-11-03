import type { AdminErrorBody } from '@nest-my-admin/core/contract';
import { activeLocale, translate as tr, type MessageKey } from '@/i18n';

/** The admin server's own texts (never a host's: those are the host's words already). */
const SERVER_TEXTS: Record<string, MessageKey> = {
  'Validation failed': 'server.validationFailed',
  'already exists': 'server.alreadyExists',
  'A record with this value already exists': 'server.recordExists',
  'is required': 'validation.required',
  'A required value is missing': 'server.requiredMissing',
  'does not exist': 'server.doesNotExist',
  'A related record does not exist': 'server.relatedMissing',
  'is not allowed': 'server.notAllowed',
  'A value is not allowed': 'server.valueNotAllowed',
  'is invalid': 'server.invalid',
  'A value is invalid for its column': 'server.valueInvalid',
  'is read-only': 'server.readOnly',
  'Some fields are read-only': 'server.someReadOnly',
  'The change conflicts with related records': 'server.conflictsWithRelated',
  'Other records still refer to this record': 'server.stillReferred',
  'is taken': 'server.taken',
  'is wrong': 'server.wrong',
  'must be text': 'server.mustBeText',
  'must be true or false': 'server.mustBeBoolean',
  'must be a list': 'server.mustBeList',
  'is not one of the choices': 'server.notAChoice',
  'is used twice': 'server.usedTwice',
  'is not an accepted file type': 'server.fileType',
  'is not a writable field': 'server.readOnly',
  'must be an uploaded file': 'server.uploadedFile',
  'Sign in first': 'server.signIn',
  'Missing or wrong X-CSRF-Token header; reload the page and try again': 'server.reload',
  'Viewing as another user is read-only': 'server.viewAsReadOnly',
  'Request body is too large': 'server.tooLarge',
  'two-factor sign-in is already on': 'server.twoFactorOn',
  'two-factor sign-in is off': 'server.twoFactorOff',
  'start the setup first': 'server.setupFirst',
};

/**
 * The texts of class-validator and of the admin's own refusals that hold a name or a number. English keeps the
 * text as sent, name included; the name is dropped elsewhere because the message stands under its field. Messages only a developer's own API call can cause stay as they are.
 */
const NAME = String.raw`^(?:(?:each value in )?\S+ )?`;
const SERVER_PATTERNS: Array<[RegExp, MessageKey]> = [
  [new RegExp(`${NAME}must be longer than or equal to 1 characters$`), 'validation.required'],
  [new RegExp(`${NAME}should not be empty$`), 'validation.required'],
  [new RegExp(`${NAME}must be longer than or equal to (\\d+) characters$`), 'server.minLength'],
  [new RegExp(`${NAME}must be shorter than or equal to (\\d+) characters$`), 'server.maxLength'],
  [new RegExp(`${NAME}must be at most (\\d+) characters$`), 'server.maxLength'],
  [new RegExp(`${NAME}must not be greater than (-?[\\d.]+)$`), 'server.max'],
  [new RegExp(`${NAME}must not be less than (-?[\\d.]+)$`), 'server.min'],
  [new RegExp(`${NAME}must be an integer number$`), 'server.integer'],
  [new RegExp(`${NAME}must be a number conforming to the specified constraints$`), 'server.number'],
  [new RegExp(`${NAME}must be a string$`), 'server.mustBeText'],
  [new RegExp(`${NAME}must be a boolean value$`), 'server.mustBeBoolean'],
  [new RegExp(`${NAME}must be one of the following values: .*$`), 'server.notAChoice'],
  [new RegExp(`${NAME}must be an email$`), 'server.email'],
  [new RegExp(`${NAME}must be a URL address$`), 'server.url'],
  [new RegExp(`${NAME}must be a (?:Date instance|valid ISO 8601 date string)$`), 'server.date'],
  [new RegExp(`${NAME}must be an array$`), 'server.mustBeList'],
  [new RegExp(`${NAME}must be a positive number$`), 'server.positive'],
  [new RegExp(`${NAME}must match .* regular expression$`), 'server.format'],
  [/^may have at most (\d+) rows$/, 'server.maxRows'],
  [/ was changed by someone else since you opened it$/, 'server.changedByOther'],
  [/ records are read-only$/, 'server.recordsReadOnly'],
  [/ is a system role(?:: .*)?$/, 'server.systemRole'],
  [/^(?:You may not |Only superusers may )/, 'server.forbidden'],
];

const persianDigits = (text: string): string => text.replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]!);

const localized = (text: string): string => {
  const key = SERVER_TEXTS[text];
  if (key) return tr(key);
  // English keeps the text exactly as the server wrote it.
  if (activeLocale().startsWith('en')) return text;
  for (const [pattern, patternKey] of SERVER_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    // The pattern's one group, when it has one, is the number.
    return tr(patternKey, { n: persianDigits(match[1] ?? '') });
  }
  return text;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: AdminErrorBody,
  ) {
    super(body.code === 'INTERNAL' && body.correlationId ? tr('common.reference', { message: body.message, id: body.correlationId }) : localized(body.message));
    this.name = 'ApiError';
  }

  get fields(): Record<string, string[]> {
    return Object.fromEntries(Object.entries(this.body.fields ?? {}).map(([name, messages]) => [name, [...new Set(messages.map(localized))]]));
  }
}

/** One line for places that show a whole error at once (list page, banners). */
export function describeError(error: Error): string {
  if (!(error instanceof ApiError)) return error.message;
  const details = Object.entries(error.fields).map(([name, messages]) => `${name}: ${messages.join(', ')}`);
  return [error.message, ...details].join(' — ');
}

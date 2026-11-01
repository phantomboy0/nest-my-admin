import type { Tone, WidgetData, WidgetType } from '../contract.js';
import { describeValue, HostContractError, isPlainObject } from '../host-contract.js';

/** The tones of badges, list items and computed cells. */
export const TONES: readonly Tone[] = ['ok', 'warn', 'bad', 'info', 'neutral', 'primary'];

const isText = (value: unknown) => typeof value === 'string';
const isNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const isTone = (value: unknown) => TONES.includes(value as Tone);

/**
 * A widget's `load()` answer checked against its `type` (spec §5.8), so a wrong shape fails here with a sentence
 * instead of breaking the dashboard in the browser.
 */
export function checkWidgetData(type: WidgetType, data: unknown, where: string): WidgetData {
  const fail = (what: string): never => {
    throw new HostContractError(`${where}.load() (a ${type} widget) ${what}`);
  };
  if (!isPlainObject(data)) fail(`returned ${describeValue(data)}; it answers the ${type} widget's data`);
  const d = data as Record<string, unknown>;
  const need = (key: string, ok: (value: unknown) => boolean, expected: string) => {
    if (!ok(d[key])) fail(`returned ${key} = ${describeValue(d[key])}; ${key} must be ${expected}`);
  };
  const optional = (key: string, ok: (value: unknown) => boolean, expected: string) => {
    if (d[key] !== undefined) need(key, ok, expected);
  };
  switch (type) {
    case 'stat':
      need('value', isText, 'a text (format numbers yourself, or String(n))');
      optional('unit', isText, 'a text');
      optional('change', isNumber, 'a number (percent)');
      optional('previousLabel', isText, 'a text');
      break;
    case 'chart':
      need('kind', (v) => v === 'bar' || v === 'line', '"bar" or "line"');
      need('labels', (v) => Array.isArray(v) && v.every(isText), 'an array of texts');
      need('series', (v) => Array.isArray(v) && v.every((s) => isPlainObject(s) && isText(s.label) && Array.isArray(s.values) && s.values.every(isNumber)), 'an array of { label, values: number[] }');
      optional('total', isText, 'a text');
      optional('subtitle', isText, 'a text');
      break;
    case 'table':
      need('columns', (v) => Array.isArray(v) && v.every((c) => isPlainObject(c) && isText(c.key) && isText(c.label)), 'an array of { key, label }');
      need(
        'rows',
        (v) => Array.isArray(v) && v.every((row) => isPlainObject(row) && Object.values(row).every((cell) => isText(cell) || isNumber(cell) || (isPlainObject(cell) && isText(cell.label) && isTone(cell.tone)))),
        `an array of rows whose cells are texts, numbers or { label, tone } (tone: ${TONES.join(', ')})`,
      );
      break;
    case 'progress':
      need('percent', isNumber, 'a number');
      need('value', isText, 'a text');
      need('caption', isText, 'a text');
      break;
    case 'list':
      need('items', (v) => Array.isArray(v) && v.every((item) => isPlainObject(item) && isText(item.text) && (item.status === undefined || isTone(item.status))), `an array of { text, status? } (status: ${TONES.join(', ')})`);
      break;
  }
  return data as WidgetData;
}

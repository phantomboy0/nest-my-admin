/** Persian (Extended Arabic-Indic) and Arabic-Indic digits, index = value. */
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const ZWNJ = '‌';
/** Arabic letters that Persian writes differently: yeh (and alef maksura) and kaf. */
const LETTER_VARIANTS: ReadonlyArray<readonly [string, string]> = [
  ['ي', 'ی'],
  ['ى', 'ی'],
  ['ك', 'ک'],
];

/** Persian and Arabic-Indic digits → Latin; other text unchanged. */
export function toLatinDigits(text: string): string {
  return text.replace(/[۰-۹٠-٩]/g, (digit) => String(Math.max(PERSIAN_DIGITS.indexOf(digit), ARABIC_DIGITS.indexOf(digit))));
}

/** A number typed with any digits: Latin digits, and the Arabic decimal (٫) and thousands (٬) separators as `.` and `,`. */
export function toLatinNumber(text: string): string {
  return toLatinDigits(text).replace(/٫/g, '.').replace(/٬/g, ',');
}

/** A search term in canonical form: Persian ی and ک, Latin digits, ZWNJ as a space. */
export function normalizeSearch(term: string): string {
  let out = toLatinDigits(term);
  for (const [variant, canonical] of LETTER_VARIANTS) out = out.replaceAll(variant, canonical);
  return out.replaceAll(ZWNJ, ' ');
}

/**
 * The replacements a column needs so that `term` (normalized) matches every stored variant. Only characters the term
 * contains need one, so a Latin search keeps a plain `LIKE`.
 */
export function columnReplacements(term: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const [variant, canonical] of LETTER_VARIANTS) if (term.includes(canonical)) pairs.push([variant, canonical]);
  for (const digit of new Set(term.match(/\d/g) ?? [])) {
    pairs.push([PERSIAN_DIGITS[Number(digit)]!, digit], [ARABIC_DIGITS[Number(digit)]!, digit]);
  }
  if (term.includes(' ')) pairs.push([ZWNJ, ' ']);
  return pairs;
}

/**
 * `LOWER(<column>) LIKE LOWER(:<name>)`, with the column's variants replaced for this term (spec §12). Returns the SQL
 * and its parameters; `pattern` builds the LIKE pattern from the normalized term.
 */
export function persianLike(column: string, term: string, name: string, pattern: (text: string) => string): { sql: string; params: Record<string, string> } {
  const normalized = normalizeSearch(term);
  const params: Record<string, string> = { [name]: pattern(normalized) };
  let expression = column;
  columnReplacements(normalized).forEach(([from, to], index) => {
    params[`${name}F${index}`] = from;
    params[`${name}T${index}`] = to;
    expression = `REPLACE(${expression}, :${name}F${index}, :${name}T${index})`;
  });
  return { sql: `LOWER(${expression}) LIKE LOWER(:${name}) ESCAPE '!'`, params };
}

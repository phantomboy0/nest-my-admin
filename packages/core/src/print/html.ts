/** Markup that `html` puts in as it is (already escaped, or trusted). */
export class HtmlString {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => ESCAPES[char]!);

/** Trusted markup, put in by `html` without escaping. Never pass it a value that came from a user. */
export const raw = (markup: string): HtmlString => new HtmlString(markup);

function render(value: unknown): string {
  if (value instanceof HtmlString) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === null || value === undefined || value === false) return '';
  return escapeHtml(String(value));
}

/**
 * Builds HTML for a print template: every interpolated value is escaped, except the result of another `html` (or
 * `raw`); arrays are joined, and `null`, `undefined` and `false` print nothing.
 *
 *     html`<td>${line.productName}</td>${lines.map((line) => html`<tr>…</tr>`)}`
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): HtmlString {
  let out = strings[0]!;
  values.forEach((value, index) => {
    out += render(value) + strings[index + 1]!;
  });
  return new HtmlString(out);
}

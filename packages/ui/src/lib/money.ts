const PLAIN = /^(-?)(\d+)(?:\.(\d*))?$/;
const GROUPED = /^-?\d{1,3}(,\d{3})+(\.\d*)?$/;

/**
 * "1234567.5" → "1,234,567.50": thousands commas, and the fraction padded to `scale`. Works on the digits as text
 * (decimals are strings on the wire), so nothing is rounded; anything that is not a plain number comes back as it is.
 */
export function groupMoney(text: string, scale?: number): string {
  const trimmed = text.trim();
  const match = PLAIN.exec(GROUPED.test(trimmed) ? trimmed.replace(/,/g, '') : trimmed);
  if (!match) return text;
  const [, sign, whole, fraction] = match;
  const grouped = whole!.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+$)/g, ',');
  const digits = scale === undefined ? (fraction ?? '') : (fraction ?? '').padEnd(scale, '0');
  return `${sign}${grouped}${digits ? `.${digits}` : ''}`;
}

/** "1,234.5" → "1234.5" when the commas group thousands correctly; otherwise the text as it is (the form reports it). */
export function ungroupMoney(text: string): string {
  const trimmed = text.trim();
  return GROUPED.test(trimmed) ? trimmed.replace(/,/g, '') : trimmed;
}

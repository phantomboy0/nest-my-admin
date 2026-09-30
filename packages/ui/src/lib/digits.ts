const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC = '٠١٢٣٤٥٦٧٨٩';

/** Persian and Arabic-Indic digits → Latin (what inputs accept, spec §12); other text unchanged. */
export function toLatinDigits(text: string): string {
  return text.replace(/[۰-۹٠-٩]/g, (digit) => String(Math.max(PERSIAN.indexOf(digit), ARABIC.indexOf(digit))));
}

/** A typed number: Latin digits, and the Arabic decimal (٫) and thousands (٬) separators as `.` and `,`. */
export function toLatinNumber(text: string): string {
  return toLatinDigits(text).replace(/٫/g, '.').replace(/٬/g, ',');
}

/** Latin digits → Persian. */
export function toPersianDigits(text: string): string {
  return text.replace(/[0-9]/g, (digit) => PERSIAN[Number(digit)]!);
}

/** A number written with Latin digits (`1,234.50`) in Persian digits and separators (`۱٬۲۳۴٫۵۰`). */
export function toPersianNumber(text: string): string {
  return toPersianDigits(text).replace(/\./g, '٫').replace(/,/g, '٬');
}

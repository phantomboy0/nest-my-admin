/**
 * A URL slug from free text: lower case, marks (accents, Arabic diacritics) dropped, every run of other characters one
 * hyphen. Letters of every script stay ("سلام دنیا" → "سلام-دنیا").
 */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

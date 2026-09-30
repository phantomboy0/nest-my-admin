/** Same encoding as the server's `_id` (core crud/record-id.ts): `~` → `~0`, `,` → `~1`, joined by `,`; `new` is `~new`. */
export function encodeRecordId(values: Array<string | number>): string {
  const encoded = values.map((value) => String(value).replace(/~/g, '~0').replace(/,/g, '~1')).join(',');
  return encoded === 'new' ? '~new' : encoded;
}

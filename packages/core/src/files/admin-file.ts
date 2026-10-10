/**
 * An uploaded file as a resource's `create`/`update` receives it, in place of the `{ token }` or `{ key }` the form
 * sent. Store `key` (the default methods write it into the column); `isNew` tells a fresh upload from a kept file.
 */
export interface AdminFile {
  /** The storage key: what the record keeps. */
  key: string;
  /** The original file name, cleaned. */
  name: string;
  /** The type sniffed from the content. */
  contentType: string;
  size: number;
  /** The storage's public URL for public files, else the admin's permission-checked download route. */
  url?: string;
  /** True for an upload this write attaches, false for a file the record already had. */
  isNew: boolean;
}

/** The files the admin resolved itself: nothing a client sends, however it is shaped, is ever taken for one. */
const resolved = new WeakSet<object>();

/** @internal */
export function markAdminFile(file: AdminFile): AdminFile {
  resolved.add(file);
  return file;
}

const isAdminFile = (value: unknown): value is AdminFile => typeof value === 'object' && value !== null && resolved.has(value);

/** @internal A copy of a write's DTO with each resolved file replaced by its key (a list of files by a list of keys). */
export function toFileKeys(dto: object): object {
  let out: Record<string, unknown> | undefined;
  for (const [name, value] of Object.entries(dto)) {
    const keys = isAdminFile(value) ? value.key : Array.isArray(value) && value.length > 0 && value.every(isAdminFile) ? value.map((file) => file.key) : undefined;
    if (keys === undefined) continue;
    out ??= Object.assign(Object.create(Object.getPrototypeOf(dto) as object | null) as Record<string, unknown>, dto);
    out[name] = keys;
  }
  return out ?? dto;
}

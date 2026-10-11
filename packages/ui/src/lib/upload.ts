import type { AdminErrorBody, UploadResponse } from '@nest-my-admin/core/contract';
import { activeDisplay, activeLocale, translate as tr } from '@/i18n';
import { ApiError } from './api-error';

/** Where and as whom an upload is sent (the API client fills this in; tests pass a fake XHR). */
export interface UploadEnvironment {
  apiBase: string;
  csrfToken?: string;
  viewAs?: string;
  locale: string;
  createXhr?: () => XMLHttpRequest;
  /** The server answered 401: the session is gone. */
  onSignedOut?: () => void;
}

export interface UploadTarget {
  resource: string;
  field: string;
}

export interface Upload {
  promise: Promise<UploadResponse>;
  /** Stops the request; the promise then rejects with `UploadAbortedError`. */
  abort: () => void;
}

/** The user cancelled the upload: nothing to report. */
export class UploadAbortedError extends Error {
  constructor() {
    super('Upload aborted');
    this.name = 'UploadAbortedError';
  }
}

/** Body types the server refuses for uploads (a plain HTML form can send them across sites). */
const SIMPLE_TYPES = new Set(['text/plain', 'multipart/form-data', 'application/x-www-form-urlencoded']);

function contentTypeOf(file: File): string {
  const type = file.type.split(';')[0]!.trim().toLowerCase();
  // The server decides the real type from the bytes; this header only has to be a non-form type.
  return type === '' || SIMPLE_TYPES.has(type) ? 'application/octet-stream' : file.type;
}

function isErrorBody(value: unknown): value is AdminErrorBody {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value;
}

function isUploadResponse(value: unknown): value is UploadResponse {
  return typeof value === 'object' && value !== null && typeof (value as UploadResponse).token === 'string';
}

/**
 * `POST <api>/uploads?resource=&field=` with the file itself as the body. XMLHttpRequest because `fetch` reports
 * no upload progress; it also sets `Content-Length`, which the server requires.
 */
export function uploadFile(file: File, target: UploadTarget, env: UploadEnvironment, onProgress?: (fraction: number) => void): Upload {
  const xhr = env.createXhr ? env.createXhr() : new XMLHttpRequest();
  let settled = false;
  const promise = new Promise<UploadResponse>((resolve, reject) => {
    const finish = (run: () => void) => {
      if (settled) return;
      settled = true;
      run();
    };
    xhr.open('POST', `${env.apiBase}/uploads?${new URLSearchParams({ resource: target.resource, field: target.field })}`);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Accept-Language', env.locale);
    xhr.setRequestHeader('Content-Type', contentTypeOf(file));
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    if (env.csrfToken) xhr.setRequestHeader('X-CSRF-Token', env.csrfToken);
    if (env.viewAs) xhr.setRequestHeader('X-View-As', env.viewAs);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      let data: unknown;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        data = undefined;
      }
      const ok = xhr.status >= 200 && xhr.status < 300 && isUploadResponse(data);
      if (xhr.status === 401) env.onSignedOut?.();
      finish(() => {
        if (ok) {
          onProgress?.(1);
          resolve(data as UploadResponse);
        } else if (isErrorBody(data)) reject(new ApiError(xhr.status, data));
        // A proxy's own answer (a body limit below the admin's, a gateway error) carries no JSON.
        else if (xhr.status === 413) reject(new ApiError(413, { code: 'BAD_REQUEST', message: tr('upload.tooLarge', {}, env.locale), correlationId: '' }));
        else reject(new ApiError(xhr.status, { code: 'INTERNAL', message: tr('common.requestFailed', { status: xhr.status }, env.locale), correlationId: '' }));
      });
    };
    xhr.onerror = () => finish(() => reject(new Error(tr('upload.network', {}, env.locale))));
    xhr.onabort = () => finish(() => reject(new UploadAbortedError()));
    xhr.send(file);
  });
  return {
    promise,
    abort: () => {
      if (!settled) xhr.abort();
    },
  };
}

/** What to show for a failed upload: the field's own message ("is not an accepted file type") when there is one. */
export function uploadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const messages = Object.values(error.fields).flat();
    if (messages.length > 0) return messages.join(' ');
  }
  return error instanceof Error ? error.message : String(error);
}

/** Whether `type` matches an `accept` list of exact types, `image/*` wildcards or a star (as the server's `accepts`). */
export function acceptsType(type: string, accept: readonly string[]): boolean {
  if (accept.length === 0) return true;
  const actual = type.toLowerCase();
  return accept.some((raw) => {
    const pattern = raw.trim().toLowerCase();
    if (pattern === '*' || pattern === '*/*') return true;
    if (pattern.endsWith('/*')) return actual.startsWith(pattern.slice(0, -1));
    return actual === pattern;
  });
}

/**
 * A reason not to send the file at all, or undefined. The server checks the real bytes; this only saves an upload
 * that is certain to be refused, so a file the browser cannot type is let through.
 */
export function checkFile(file: { type: string; size: number }, rules: { accept: readonly string[]; maxBytes: number }, locale?: string): string | undefined {
  if (file.size === 0) return tr('upload.empty', {}, locale);
  if (file.size > rules.maxBytes) return tr('upload.tooLargeMax', { max: formatBytes(rules.maxBytes, locale) }, locale);
  if (file.type !== '' && !acceptsType(file.type.split(';')[0]!.trim(), rules.accept)) return tr('upload.typeRefused', {}, locale);
  return undefined;
}

const UNITS = ['upload.bytes', 'upload.kilobytes', 'upload.megabytes', 'upload.gigabytes', 'upload.terabytes'] as const;

/** `1.5 KB`, `10 MB` (`۱٫۵ کیلوبایت` in Persian): binary steps, at most one decimal, the unit from the texts. */
export function formatBytes(bytes: number, locale?: string): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const number = new Intl.NumberFormat(locale ?? `${activeLocale()}-u-nu-${activeDisplay().digits}`, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value);
  return tr(UNITS[unit]!, { value: number }, locale);
}

/** `items` with the one at `from` moved to `to`; unchanged when either index is outside the list. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

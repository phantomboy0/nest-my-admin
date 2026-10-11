import { describe, expect, test } from 'bun:test';
import { ApiError } from './api-error';
import { UploadAbortedError, checkFile, formatBytes, moveItem, uploadErrorMessage, uploadFile, type UploadEnvironment } from './upload';

/** The parts of XMLHttpRequest the uploader uses; tests drive the events by hand. */
class FakeXhr {
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  responseText = '';
  withCredentials = false;
  aborted = false;
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
    this.onload?.();
  }
}

function setup(extra: Partial<UploadEnvironment> = {}) {
  const xhr = new FakeXhr();
  let signedOut = 0;
  const env: UploadEnvironment = {
    apiBase: '/admin/api',
    csrfToken: 'csrf-1',
    locale: 'fa',
    createXhr: () => xhr as unknown as XMLHttpRequest,
    onSignedOut: () => {
      signedOut += 1;
    },
    ...extra,
  };
  return { xhr, env, signedOut: () => signedOut };
}

const png = (name = 'cat.png', type = 'image/png') => new File([new Uint8Array([1, 2, 3])], name, { type });
const target = { resource: 'product', field: 'image' };

describe('uploadFile', () => {
  test('posts the raw file with its type, name, CSRF token and language', () => {
    const { xhr, env } = setup();
    const file = png('عکس من.png');
    void uploadFile(file, target, env).promise.catch(() => {});
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/admin/api/uploads?resource=product&field=image');
    expect(xhr.body).toBe(file);
    expect(xhr.headers['Content-Type']).toBe('image/png');
    expect(xhr.headers['X-File-Name']).toBe(encodeURIComponent('عکس من.png'));
    expect(xhr.headers['X-CSRF-Token']).toBe('csrf-1');
    expect(xhr.headers['Accept-Language']).toBe('fa');
    expect(xhr.headers.Accept).toBe('application/json');
    expect(xhr.headers['X-View-As']).toBeUndefined();
    expect(xhr.withCredentials).toBe(false); // same origin: cookies go anyway
  });

  test('a file without a type, or with one the server refuses as a body type, goes as octet-stream', () => {
    for (const type of ['', 'text/plain', 'TEXT/PLAIN;charset=utf-8', 'multipart/form-data', 'application/x-www-form-urlencoded']) {
      const { xhr, env } = setup();
      void uploadFile(png('notes.txt', type), target, env).promise.catch(() => {});
      expect(xhr.headers['Content-Type'], type).toBe('application/octet-stream');
    }
  });

  test('resource and field are encoded; no CSRF header without a token', () => {
    const { xhr, env } = setup({ csrfToken: undefined, viewAs: '7' });
    void uploadFile(png(), { resource: 'stock-move', field: 'a&b' }, env).promise.catch(() => {});
    expect(xhr.url).toBe('/admin/api/uploads?resource=stock-move&field=a%26b');
    expect(xhr.headers['X-CSRF-Token']).toBeUndefined();
    expect(xhr.headers['X-View-As']).toBe('7');
  });

  test('resolves with the upload response', async () => {
    const { xhr, env } = setup();
    const { promise } = uploadFile(png(), target, env);
    xhr.respond(201, { token: 't-1', name: 'cat.png', contentType: 'image/png', size: 3, url: '/admin/api/files/a/b.png' });
    expect(await promise).toEqual({ token: 't-1', name: 'cat.png', contentType: 'image/png', size: 3, url: '/admin/api/files/a/b.png' });
  });

  test('reports progress as a fraction, and 1 when done', async () => {
    const { xhr, env } = setup();
    const seen: number[] = [];
    const { promise } = uploadFile(png(), target, env, (fraction) => seen.push(fraction));
    xhr.upload.onprogress!({ lengthComputable: true, loaded: 1, total: 4 });
    xhr.upload.onprogress!({ lengthComputable: false, loaded: 2, total: 0 });
    xhr.upload.onprogress!({ lengthComputable: true, loaded: 3, total: 4 });
    xhr.respond(201, { token: 't', name: 'cat.png', contentType: 'image/png', size: 3 });
    await promise;
    expect(seen).toEqual([0.25, 0.75, 1]);
  });

  test('abort rejects with UploadAbortedError', async () => {
    const { xhr, env } = setup();
    const upload = uploadFile(png(), target, env);
    upload.abort();
    expect(xhr.aborted).toBe(true);
    await expect(upload.promise).rejects.toBeInstanceOf(UploadAbortedError);
  });

  test('abort after the answer changes nothing', async () => {
    const { xhr, env } = setup();
    const upload = uploadFile(png(), target, env);
    xhr.respond(201, { token: 't', name: 'cat.png', contentType: 'image/png', size: 3 });
    upload.abort();
    expect((await upload.promise).token).toBe('t');
    expect(xhr.aborted).toBe(false);
  });

  test("the server's error body becomes an ApiError", async () => {
    const { xhr, env } = setup();
    const { promise } = uploadFile(png(), target, env);
    xhr.respond(422, { code: 'VALIDATION', message: 'Validation failed', fields: { image: ['is not an accepted file type'] }, correlationId: 'c1' });
    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    // The field's own message is what the widget shows.
    expect(uploadErrorMessage(error)).toBe('is not an accepted file type');
    expect(uploadErrorMessage(new ApiError(403, { code: 'FORBIDDEN', message: 'No access', correlationId: 'c' }))).toBe('No access');
  });

  test('413 says the file is too large even when a proxy answers without JSON', async () => {
    const { xhr, env } = setup({ locale: 'en' });
    const { promise } = uploadFile(png(), target, env);
    xhr.respond(413, '<html>Request Entity Too Large</html>');
    const error = (await promise.catch((caught: unknown) => caught)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(413);
    expect(error.message).toBe('The file is too large.');
  });

  test('another status without a JSON error names the status', async () => {
    const { xhr, env } = setup({ locale: 'en' });
    const { promise } = uploadFile(png(), target, env);
    xhr.respond(502, 'Bad gateway');
    const error = (await promise.catch((caught: unknown) => caught)) as ApiError;
    expect(error.status).toBe(502);
    expect(error.message).toBe('Request failed (502)');
  });

  test('a 2xx that is not an upload response is an error, not a broken value', async () => {
    const { xhr, env } = setup({ locale: 'en' });
    const { promise } = uploadFile(png(), target, env);
    xhr.respond(200, '<html>login</html>');
    const error = (await promise.catch((caught: unknown) => caught)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe('Request failed (200)');
  });

  test('a network failure is an error with a readable message', async () => {
    const { xhr, env } = setup({ locale: 'en' });
    const { promise } = uploadFile(png(), target, env);
    xhr.onerror!();
    const error = (await promise.catch((caught: unknown) => caught)) as Error;
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error.message).toBe('The upload failed. Check your connection and try again.');
  });

  test('401 signs the user out', async () => {
    const { xhr, env, signedOut } = setup();
    const { promise } = uploadFile(png(), target, env);
    xhr.respond(401, { code: 'UNAUTHENTICATED', message: 'Sign in', correlationId: 'c' });
    await promise.catch(() => {});
    expect(signedOut()).toBe(1);
  });
});

describe('checkFile', () => {
  const rules = { accept: ['image/*', 'application/pdf'], maxBytes: 1000 };
  test('accepts what the field allows', () => {
    expect(checkFile({ type: 'image/png', size: 1000 }, rules, 'en')).toBeUndefined();
    expect(checkFile({ type: 'APPLICATION/PDF', size: 1 }, rules, 'en')).toBeUndefined();
    expect(checkFile({ type: 'video/mp4', size: 1 }, { accept: ['*/*'], maxBytes: 10 }, 'en')).toBeUndefined();
    expect(checkFile({ type: 'video/mp4', size: 1 }, { accept: ['*'], maxBytes: 10 }, 'en')).toBeUndefined();
    expect(checkFile({ type: 'video/mp4', size: 1 }, { accept: [], maxBytes: 10 }, 'en')).toBeUndefined();
  });
  test('a file the browser cannot type is left to the server', () => {
    expect(checkFile({ type: '', size: 1 }, rules, 'en')).toBeUndefined();
  });
  test('refuses other types and files over the limit', () => {
    expect(checkFile({ type: 'video/mp4', size: 1 }, rules, 'en')).toBe('This type of file is not accepted here.');
    expect(checkFile({ type: 'image/png', size: 1001 }, rules, 'en')).toBe('The file is too large (at most 1,000 B).');
    expect(checkFile({ type: 'image/png', size: 0 }, rules, 'en')).toBe('The file is empty.');
  });
});

test('formatBytes', () => {
  expect(formatBytes(0, 'en')).toBe('0 B');
  expect(formatBytes(1023, 'en')).toBe('1,023 B');
  expect(formatBytes(1024, 'en')).toBe('1 KB');
  expect(formatBytes(1536, 'en')).toBe('1.5 KB');
  expect(formatBytes(10 * 1024 * 1024, 'en')).toBe('10 MB');
  expect(formatBytes(3.25 * 1024 ** 3, 'en')).toBe('3.3 GB');
  // Units are texts: Persian names them, and the number follows the locale.
  expect(formatBytes(1536, 'fa')).toBe(`${new Intl.NumberFormat('fa', { maximumFractionDigits: 1 }).format(1.5)} کیلوبایت`);
  expect(formatBytes(2 * 1024 * 1024, 'fa-u-nu-latn')).toBe('2 MB'); // an unknown bundle falls back to English
});

test('moveItem: what a drop or an arrow button does to the list', () => {
  const files = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }];
  const keys = (list: Array<{ key: string }>) => list.map((file) => file.key).join('');
  expect(keys(moveItem(files, 0, 1))).toBe('bacd'); // the down arrow on the first
  expect(keys(moveItem(files, 3, 2))).toBe('abdc'); // the up arrow on the last
  expect(keys(moveItem(files, 1, 3))).toBe('acdb'); // dragged onto a later row: lands in that row's place
  expect(keys(moveItem(files, 3, 0))).toBe('dabc'); // dragged onto an earlier row
  expect(keys(moveItem(files, 2, 2))).toBe('abcd'); // dropped on itself
  expect(moveItem(files, 0, 1)[1]).toBe(files[0]!); // the same objects, so previews and keys stay attached
  expect(keys(files)).toBe('abcd'); // the form's value is never changed in place
});

test('moveItem at the edges', () => {
  expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  expect(moveItem(['a', 'b', 'c'], 0, 5)).toEqual(['a', 'b', 'c']);
  expect(moveItem(['a', 'b', 'c'], -1, 0)).toEqual(['a', 'b', 'c']);
});

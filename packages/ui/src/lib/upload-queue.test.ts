import { describe, expect, test } from 'bun:test';
import type { UploadResponse } from '@nest-my-admin/core/contract';
import { UploadAbortedError, type Upload } from './upload';
import { UploadQueue } from './upload-queue';

interface Sent {
  file: File;
  progress: (fraction: number) => void;
  resolve: (stored: UploadResponse) => void;
  reject: (error: unknown) => void;
  aborted: boolean;
}

function setup(check: (file: File) => string | undefined = () => undefined) {
  const sent: Sent[] = [];
  const revoked: string[] = [];
  let changes = 0;
  const queue = new UploadQueue({
    send: (file, onProgress): Upload => {
      let entry!: Sent;
      const promise = new Promise<UploadResponse>((resolve, reject) => {
        entry = { file, progress: onProgress, resolve, reject, aborted: false };
      });
      sent.push(entry);
      return {
        promise,
        abort: () => {
          entry.aborted = true;
          entry.reject(new UploadAbortedError());
        },
      };
    },
    check,
    describe: (name, message) => `${name}: ${message}`,
    preview: (file) => (file.type.startsWith('image/') ? `blob:${file.name}` : undefined),
    revoke: (url) => revoked.push(url),
    onChange: () => {
      changes += 1;
    },
  });
  return { queue, sent, revoked, changes: () => changes };
}

const file = (name: string, type = 'image/png') => new File([new Uint8Array([1])], name, { type });
const stored = (token: string, name: string): UploadResponse => ({ token, name, contentType: 'image/png', size: 1 });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('UploadQueue', () => {
  test('tracks an upload from start to stored, with progress and a preview for images', async () => {
    const { queue, sent, revoked, changes } = setup();
    const done: Array<[string, string | undefined]> = [];
    queue.start([file('a.png'), file('b.pdf', 'application/pdf')], (response, _file, preview) => done.push([response.token, preview]));
    expect(queue.pending.map((item) => [item.name, item.progress, item.preview])).toEqual([['a.png', 0, 'blob:a.png'], ['b.pdf', 0, undefined]]);
    expect(queue.busy).toBe(true);
    sent[0]!.progress(0.5);
    expect(queue.pending[0]!.progress).toBe(0.5);
    sent[0]!.resolve(stored('t1', 'a.png'));
    sent[1]!.resolve(stored('t2', 'b.pdf'));
    await settle();
    expect(done).toEqual([['t1', 'blob:a.png'], ['t2', undefined]]);
    expect(queue.pending).toEqual([]);
    expect(queue.busy).toBe(false);
    expect(revoked).toEqual([]); // the preview now belongs to whoever took the stored file
    expect(changes()).toBeGreaterThanOrEqual(4);
  });

  test('a refused file is never sent; a failed one is reported and its preview revoked', async () => {
    const { queue, sent, revoked } = setup((candidate) => (candidate.name === 'big.png' ? 'too large' : undefined));
    const done: string[] = [];
    queue.start([file('big.png'), file('ok.png')], (response) => done.push(response.token));
    expect(sent.map((entry) => entry.file.name)).toEqual(['ok.png']);
    expect(queue.problems).toEqual(['big.png: too large']);
    sent[0]!.reject(new Error('is not an accepted file type'));
    await settle();
    expect(done).toEqual([]);
    expect(queue.problems).toEqual(['big.png: too large', 'ok.png: is not an accepted file type']);
    expect(revoked).toEqual(['blob:ok.png']);
    expect(queue.pending).toEqual([]);
  });

  test('starting again clears the old problems', () => {
    const { queue } = setup(() => 'no');
    queue.start([file('a.png')], () => {});
    queue.start([file('b.png')], () => {});
    expect(queue.problems).toEqual(['b.png: no']);
  });

  test('cancel aborts that upload only, without a problem', async () => {
    const { queue, sent, revoked } = setup();
    const done: string[] = [];
    queue.start([file('a.png'), file('b.png')], (response) => done.push(response.token));
    queue.cancel(queue.pending[0]!.id);
    await settle();
    expect(sent.map((entry) => entry.aborted)).toEqual([true, false]);
    expect(queue.pending.map((item) => item.name)).toEqual(['b.png']);
    expect(queue.problems).toEqual([]);
    expect(revoked).toEqual(['blob:a.png']);
    sent[1]!.resolve(stored('t2', 'b.png'));
    await settle();
    expect(done).toEqual(['t2']);
  });

  test('cancelAll (one-file fields: a new pick replaces the upload on its way)', async () => {
    const { queue, sent } = setup();
    queue.start([file('a.png')], () => {});
    queue.cancelAll();
    await settle();
    expect(sent[0]!.aborted).toBe(true);
    expect(queue.busy).toBe(false);
  });

  test('dispose (unmount) aborts every upload, hands nothing over and stays silent', async () => {
    const { queue, sent, revoked, changes } = setup();
    const done: string[] = [];
    queue.start([file('a.png'), file('b.png')], (response) => done.push(response.token));
    const before = changes();
    queue.dispose();
    await settle();
    expect(sent.map((entry) => entry.aborted)).toEqual([true, true]);
    expect(revoked.sort()).toEqual(['blob:a.png', 'blob:b.png']);
    expect(done).toEqual([]);
    expect(changes()).toBe(before);
    // An answer that was already on its way is dropped too.
    queue.start([file('late.png')], (response) => done.push(response.token));
    expect(sent).toHaveLength(2);
  });

  test('report adds a problem from outside (a stored upload the caller could not use)', () => {
    const { queue } = setup();
    queue.report('a.png', 'no address');
    expect(queue.problems).toEqual(['a.png: no address']);
  });
});

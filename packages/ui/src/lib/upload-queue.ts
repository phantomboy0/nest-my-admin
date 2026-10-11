import type { UploadResponse } from '@nest-my-admin/core/contract';
import { UploadAbortedError, uploadErrorMessage, type Upload } from './upload';

export interface PendingUpload {
  id: number;
  name: string;
  /** 0 to 1. */
  progress: number;
  /** A local object URL for images, shown while the bytes travel. */
  preview?: string;
}

export interface UploadQueueOptions {
  /** Starts one upload (the API client's `upload` for a field). */
  send: (file: File, onProgress: (fraction: number) => void) => Upload;
  /** A reason not to send the file at all. */
  check: (file: File) => string | undefined;
  /** "name: message" in the user's language. */
  describe: (name: string, message: string) => string;
  /** A local URL to show the file from while it travels, for files that can be shown. */
  preview?: (file: File) => string | undefined;
  revoke?: (url: string) => void;
  /** Something in `pending` or `problems` changed. */
  onChange: () => void;
}

/**
 * The uploads of one field on their way: checks each file, sends it, tracks progress, and reports what went wrong.
 * File, image and rich-text fields share it. Plain state with a change callback, so React only wraps it.
 */
export class UploadQueue {
  pending: PendingUpload[] = [];
  problems: string[] = [];
  private readonly uploads = new Map<number, Upload>();
  private nextId = 0;
  private disposed = false;

  constructor(private readonly options: UploadQueueOptions) {}

  get busy(): boolean {
    return this.pending.length > 0;
  }

  /**
   * Sends the files. `onStored` gets each finished upload with its preview URL, which is then the caller's to
   * revoke; previews of failed and cancelled uploads are revoked here.
   */
  start(files: File[], onStored: (stored: UploadResponse, file: File, preview: string | undefined) => void): void {
    if (this.disposed || files.length === 0) return;
    this.problems = [];
    for (const file of files) {
      const refused = this.options.check(file);
      if (refused) {
        this.problems = [...this.problems, this.options.describe(file.name, refused)];
        continue;
      }
      const id = ++this.nextId;
      const preview = this.options.preview?.(file);
      const upload = this.options.send(file, (progress) => {
        if (this.disposed) return;
        this.pending = this.pending.map((item) => (item.id === id ? { ...item, progress } : item));
        this.options.onChange();
      });
      this.uploads.set(id, upload);
      this.pending = [...this.pending, { id, name: file.name, progress: 0, preview }];
      upload.promise.then(
        (stored) => {
          if (this.disposed) return; // unmounted in the meantime: `dispose` revoked the preview
          this.finish(id);
          onStored(stored, file, preview);
        },
        (error: unknown) => {
          if (this.disposed) return;
          if (preview) this.options.revoke?.(preview);
          if (!(error instanceof UploadAbortedError)) this.problems = [...this.problems, this.options.describe(file.name, uploadErrorMessage(error))];
          this.finish(id);
        },
      );
    }
    this.options.onChange();
  }

  /** A problem found by the caller after the upload itself went well. */
  report(name: string, message: string): void {
    this.problems = [...this.problems, this.options.describe(name, message)];
    this.options.onChange();
  }

  cancel(id: number): void {
    this.uploads.get(id)?.abort();
  }

  cancelAll(): void {
    for (const upload of [...this.uploads.values()]) upload.abort();
  }

  /** The field is gone (unmount): stop sending, free the previews, call nobody back. */
  dispose(): void {
    this.disposed = true;
    for (const item of this.pending) if (item.preview) this.options.revoke?.(item.preview);
    this.cancelAll();
    this.uploads.clear();
    this.pending = [];
  }

  private finish(id: number): void {
    this.uploads.delete(id);
    this.pending = this.pending.filter((item) => item.id !== id);
    this.options.onChange();
  }
}

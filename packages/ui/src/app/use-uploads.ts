import { useEffect, useReducer, useRef, useState, type DragEvent } from 'react';
import type { FieldSchema } from '@nest-my-admin/core/contract';
import { useT } from '@/i18n';
import { api } from '@/lib/api';
import { fileValuesOf, type FileValue, type FormValue } from '@/lib/form-values';
import { checkFile, moveItem } from '@/lib/upload';
import { UploadQueue } from '@/lib/upload-queue';

interface UploadsOptions {
  /** The resource being edited: uploads are made for one field of one resource. */
  resource: string;
  field: FieldSchema;
  /** What the field takes (`field.file`, or images up to the editor's limit). */
  rules: { accept: readonly string[]; maxBytes: number };
  /** Told while uploads are running, so the form waits with saving. */
  onBusy?: (busy: boolean) => void;
}

/**
 * The uploads of one field (`UploadQueue`) as React state: file, image and rich-text fields all send their files
 * through it. Leaving the form aborts what is still on its way.
 */
export function useUploads({ resource, field, rules, onBusy }: UploadsOptions): UploadQueue {
  const t = useT();
  const [, render] = useReducer((count: number) => count + 1, 0);
  // The queue outlives renders; what it calls is read through a ref so it always sees the current props.
  const current = useRef({ resource, field, rules, t });
  current.current = { resource, field, rules, t };
  const queue = useRef<UploadQueue | null>(null);
  const create = () =>
    new UploadQueue({
      send: (file, onProgress) => api.upload(file, { resource: current.current.resource, field: current.current.field.name }, onProgress),
      check: (file) => checkFile(file, current.current.rules),
      describe: (name, message) => current.current.t('upload.failed', { name, message }),
      preview: (file) => (file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined),
      revoke: (url) => URL.revokeObjectURL(url),
      onChange: render,
    });
  queue.current ??= create();

  const busy = queue.current.busy;
  useEffect(() => {
    onBusy?.(busy);
  }, [busy]);
  useEffect(() => {
    // StrictMode mounts twice in development: the first cleanup disposed of the queue.
    if (!queue.current) {
      queue.current = create();
      render();
    }
    return () => {
      queue.current?.dispose();
      queue.current = null;
      onBusy?.(false);
    };
  }, []);
  return queue.current;
}

export interface FileFieldOptions {
  resource: string;
  field: FieldSchema;
  value: FormValue | undefined;
  onChange: (value: FormValue) => void;
  onBusy?: (busy: boolean) => void;
}

/**
 * The state of a file or image field: the files it holds, the uploads on their way, and what went wrong. One file
 * for a plain field (a new one replaces it), a list in order for `file.many`.
 */
export function useFileField({ resource, field, value, onChange, onBusy }: FileFieldOptions) {
  const many = field.file?.many === true;
  const files = fileValuesOf(value);
  // Uploads finish outside React's render cycle: they add to the list as it is then, not as it was when they started.
  const latest = useRef(files);
  latest.current = files;
  const queue = useUploads({ resource, field, rules: field.file ?? { accept: [], maxBytes: Infinity }, onBusy });
  /** Object URLs of new uploads by token: a private upload has no URL to show it from until the record is saved. */
  const previews = useRef(new Map<string, string>());
  useEffect(
    () => () => {
      for (const url of previews.current.values()) URL.revokeObjectURL(url);
      previews.current.clear();
    },
    [],
  );

  function emit(next: FileValue[]) {
    // A removed or replaced upload is not shown again: free its local copy.
    const kept = new Set(next.map((file) => file.token));
    for (const [token, url] of previews.current) {
      if (kept.has(token)) continue;
      URL.revokeObjectURL(url);
      previews.current.delete(token);
    }
    latest.current = next;
    onChange(many ? next : (next[0] ?? null));
  }

  function add(chosen: File[]) {
    const accepted = many ? chosen : chosen.slice(0, 1);
    if (accepted.length === 0) return;
    // One file: picking another while the first still travels replaces it.
    if (!many) queue.cancelAll();
    queue.start(accepted, (stored, _file, preview) => {
      if (preview) previews.current.set(stored.token, preview);
      const added: FileValue = { token: stored.token, name: stored.name, size: stored.size, contentType: stored.contentType, ...(stored.url ? { url: stored.url } : {}) };
      emit(many ? [...latest.current, added] : [added]);
    });
  }

  return {
    many,
    files,
    pending: queue.pending,
    problems: queue.problems,
    add,
    remove: (index: number) => emit(files.filter((_, at) => at !== index)),
    move: (from: number, to: number) => emit(moveItem(files, from, to)),
    cancel: (id: number) => queue.cancel(id),
    /** Where a file can be shown from: its URL, else the local copy of a new upload. */
    previewOf: (file: FileValue) => file.url ?? (file.token ? previews.current.get(file.token) : undefined),
  };
}

/**
 * Drag-to-reorder for a list of files (native drag events; the arrow buttons do the same from the keyboard).
 * Spread `item(index)` on each row; a drop calls `move(from, to)` (`moveItem` in `lib/upload.ts`).
 */
export function useReorder(move: (from: number, to: number) => void) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const end = () => {
    setDragging(null);
    setOver(null);
  };
  return {
    dragging,
    over,
    item: (index: number) => ({
      draggable: true,
      onDragStart: (event: DragEvent) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index)); // Firefox starts no drag without data
        setDragging(index);
      },
      onDragOver: (event: DragEvent) => {
        if (dragging === null) return; // a file from the desktop: the drop zone takes it
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setOver(index);
      },
      onDrop: (event: DragEvent) => {
        if (dragging === null) return;
        event.preventDefault();
        move(dragging, index);
        end();
      },
      onDragEnd: end,
    }),
  };
}

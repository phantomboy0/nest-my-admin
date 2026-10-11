import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ArrowDown, ArrowUp, File as FileIcon, GripVertical, Upload as UploadIcon, X } from 'lucide-react';
import type { FieldSchema } from '@nest-my-admin/core/contract';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { api } from '@/lib/api';
import { fileValuesOf, type FileValue, type FormValue } from '@/lib/form-values';
import { UploadAbortedError, checkFile, formatBytes, moveItem, uploadErrorMessage, type Upload } from '@/lib/upload';
import { cn } from '@/lib/utils';

export interface FileFieldProps {
  id: string;
  /** The resource being edited: uploads are made for one field of one resource. */
  resource: string;
  field: FieldSchema;
  value: FormValue | undefined;
  onChange: (value: FormValue) => void;
  /** Told while uploads are running, so the form waits with saving. */
  onBusy?: (busy: boolean) => void;
  aria: { 'aria-invalid'?: true; 'aria-describedby'?: string };
}

export interface PendingUpload {
  id: number;
  name: string;
  /** 0 to 1. */
  progress: number;
  /** A local object URL for images, shown while the bytes travel. */
  preview?: string;
}

/**
 * The state of a file or image field: the files it holds, the uploads on their way, and what went wrong. One file
 * for a plain field (a new one replaces it), a list in order for `file.many`.
 */
export function useFileField({ resource, field, value, onChange, onBusy }: Pick<FileFieldProps, 'resource' | 'field' | 'value' | 'onChange' | 'onBusy'>) {
  const t = useT();
  const many = field.file?.many === true;
  const files = fileValuesOf(value);
  // Uploads finish outside React's render cycle: they add to the list as it is then, not as it was when they started.
  const latest = useRef(files);
  latest.current = files;
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const uploads = useRef(new Map<number, Upload>());
  /** Object URLs of new uploads by token: a private upload has no URL to show it from until the record is saved. */
  const previews = useRef(new Map<string, string>());
  const nextId = useRef(0);

  const busy = pending.length > 0;
  useEffect(() => {
    onBusy?.(busy);
  }, [busy]);
  useEffect(
    () => () => {
      for (const upload of uploads.current.values()) upload.abort();
      for (const url of previews.current.values()) URL.revokeObjectURL(url);
      onBusy?.(false);
    },
    [],
  );

  function emit(next: FileValue[]) {
    latest.current = next;
    onChange(many ? next : (next[0] ?? null));
  }

  function add(chosen: File[]) {
    const accepted = many ? chosen : chosen.slice(0, 1);
    if (accepted.length === 0) return;
    setProblems([]);
    // One file: picking another while the first still travels replaces it.
    if (!many) for (const upload of uploads.current.values()) upload.abort();
    for (const file of accepted) {
      const refused = checkFile(file, field.file ?? { accept: [], maxBytes: Infinity });
      if (refused) {
        setProblems((previous) => [...previous, t('upload.failed', { name: file.name, message: refused })]);
        continue;
      }
      const id = ++nextId.current;
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      const upload = api.upload(file, { resource, field: field.name }, (progress) => setPending((items) => items.map((item) => (item.id === id ? { ...item, progress } : item))));
      uploads.current.set(id, upload);
      setPending((items) => [...items, { id, name: file.name, progress: 0, preview }]);
      upload.promise
        .then(
          (stored) => {
            if (preview) previews.current.set(stored.token, preview);
            const added: FileValue = { token: stored.token, name: stored.name, size: stored.size, contentType: stored.contentType, ...(stored.url ? { url: stored.url } : {}) };
            emit(many ? [...latest.current, added] : [added]);
          },
          (error: unknown) => {
            if (preview) URL.revokeObjectURL(preview);
            if (!(error instanceof UploadAbortedError)) setProblems((previous) => [...previous, t('upload.failed', { name: file.name, message: uploadErrorMessage(error) })]);
          },
        )
        .finally(() => {
          uploads.current.delete(id);
          setPending((items) => items.filter((item) => item.id !== id));
        });
    }
  }

  return {
    many,
    files,
    pending,
    problems,
    add,
    remove: (index: number) => emit(files.filter((_, at) => at !== index)),
    move: (from: number, to: number) => emit(moveItem(files, from, to)),
    cancel: (id: number) => uploads.current.get(id)?.abort(),
    /** Where a file can be shown from: its URL, else the local copy of a new upload. */
    previewOf: (file: FileValue) => file.url ?? (file.token ? previews.current.get(file.token) : undefined),
  };
}

/**
 * Drag-to-reorder for a list of files (native drag events; the arrow buttons do the same from the keyboard).
 * Spread `item(index)` on each row.
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

interface DropZoneProps {
  id: string;
  field: FieldSchema;
  /** "Choose a file", "Replace", … */
  label: string;
  /** Only the button: for a field that already holds its one file. */
  compact?: boolean;
  onFiles: (files: File[]) => void;
  aria: FileFieldProps['aria'];
}

/** The file picker, also a target for files dragged from the desktop. The input itself carries the field's label. */
export function DropZone({ id, field, label, compact, onFiles, aria }: DropZoneProps) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [hovering, setHovering] = useState(false);
  const many = field.file?.many === true;
  const accept = field.file?.accept ?? [];
  const anything = accept.length === 0 || accept.some((type) => type === '*' || type === '*/*');
  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');
  return (
    <div
      data-dropzone={field.name}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setHovering(true);
      }}
      onDragLeave={() => setHovering(false)}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setHovering(false);
        onFiles([...event.dataTransfer.files]);
      }}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg text-sm has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50',
        !compact && 'border border-dashed border-input px-3 py-3',
        hovering && 'border-primary bg-muted/50',
      )}
    >
      <input
        ref={input}
        id={id}
        type="file"
        className="sr-only"
        multiple={many}
        accept={anything ? undefined : accept.join(',')}
        onChange={(event) => {
          onFiles([...(event.target.files ?? [])]);
          event.target.value = ''; // the same file can be picked again
        }}
        {...aria}
      />
      {/* The input above is what keyboards and screen readers use; this is its visible face. */}
      <Button type="button" variant="outline" size="sm" tabIndex={-1} aria-hidden onClick={() => input.current?.click()}>
        <UploadIcon />
        {label}
      </Button>
      {!compact && (
        <span className="text-muted-foreground">
          {t(many ? 'upload.dropMany' : 'upload.drop')}
          {field.file && ` · ${t('upload.limit', { max: formatBytes(field.file.maxBytes) })}`}
        </span>
      )}
    </div>
  );
}

/** An upload on its way: a bar, and a way to stop it. */
export function UploadProgress({ upload, onCancel, className }: { upload: PendingUpload; onCancel: () => void; className?: string }) {
  const t = useT();
  const percent = Math.round(upload.progress * 100);
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div role="progressbar" aria-label={t('upload.uploading', { name: upload.name })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <Button type="button" variant="ghost" size="icon-xs" aria-label={t('upload.cancel', { name: upload.name })} onClick={onCancel}>
        <X />
      </Button>
    </div>
  );
}

export function UploadProblems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <ul role="alert" className="flex flex-col gap-0.5 text-sm text-destructive">
      {problems.map((problem, index) => (
        <li key={index}>{problem}</li>
      ))}
    </ul>
  );
}

/** A file field: the file's name and size with Remove (a list to reorder for `many`), and a drop zone to add or replace. */
export function FileInput(props: FileFieldProps) {
  const t = useT();
  const { id, field, aria } = props;
  const { many, files, pending, problems, add, remove, move, cancel } = useFileField(props);
  const reorder = useReorder(move);
  return (
    <div className="flex flex-col gap-2">
      {(files.length > 0 || pending.length > 0) && (
        <ul className="flex flex-col gap-1">
          {files.map((file, index) => (
            <li
              key={file.token ?? file.key}
              data-file={file.name}
              {...(many && files.length > 1 ? reorder.item(index) : {})}
              className={cn('flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm', reorder.dragging === index && 'opacity-50', reorder.over === index && reorder.dragging !== index && 'border-primary')}
            >
              {many && files.length > 1 ? <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden /> : <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
              {file.url ? (
                <a href={file.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate hover:underline" aria-label={t('upload.open', { name: file.name })}>
                  <bdi>{file.name}</bdi>
                </a>
              ) : (
                <bdi className="min-w-0 truncate">{file.name}</bdi>
              )}
              <span className="ms-auto shrink-0 text-muted-foreground">{formatBytes(file.size)}</span>
              {many && files.length > 1 && (
                <>
                  <Button type="button" variant="ghost" size="icon-xs" disabled={index === 0} aria-label={t('list.moveUp', { name: file.name })} onClick={() => move(index, index - 1)}>
                    <ArrowUp />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-xs" disabled={index === files.length - 1} aria-label={t('list.moveDown', { name: file.name })} onClick={() => move(index, index + 1)}>
                    <ArrowDown />
                  </Button>
                </>
              )}
              <Button type="button" variant="ghost" size="icon-xs" aria-label={t('upload.remove', { name: file.name })} onClick={() => remove(index)}>
                <X />
              </Button>
            </li>
          ))}
          {pending.map((upload) => (
            <li key={`pending-${upload.id}`} className="flex flex-col gap-1 rounded-lg border border-dashed px-2 py-1.5 text-sm">
              <bdi className="truncate text-muted-foreground">{upload.name}</bdi>
              <UploadProgress upload={upload} onCancel={() => cancel(upload.id)} />
            </li>
          ))}
        </ul>
      )}
      <DropZone id={id} field={field} label={t(many ? 'upload.chooseMany' : files.length > 0 ? 'upload.replace' : 'upload.choose')} compact={!many && files.length > 0} onFiles={add} aria={aria} />
      <UploadProblems problems={problems} />
    </div>
  );
}

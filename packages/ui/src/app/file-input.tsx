import { useRef, useState, type DragEvent } from 'react';
import { ArrowDown, ArrowUp, File as FileIcon, GripVertical, Upload as UploadIcon, X } from 'lucide-react';
import type { FieldSchema } from '@nest-my-admin/core/contract';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { useFileField, useReorder } from '@/app/use-uploads';
import type { FormValue } from '@/lib/form-values';
import { formatBytes } from '@/lib/upload';
import type { PendingUpload } from '@/lib/upload-queue';
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

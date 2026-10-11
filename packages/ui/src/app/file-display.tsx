import { File as FileIcon } from 'lucide-react';
import type { AdminFileRef, FieldSchema } from '@nest-my-admin/core/contract';
import { useT } from '@/i18n';
import { formatBytes } from '@/lib/upload';
import { cn } from '@/lib/utils';

interface FileDisplayProps {
  field: FieldSchema;
  /** The record's files for the field (`_files`), one or many. */
  files: AdminFileRef[];
  /** Larger previews and file sizes (read-only form fields); lists get small thumbnails. */
  detailed?: boolean;
  /** No links: for places that are a link themselves (the cards of the phone list). */
  plain?: boolean;
}

/** How many thumbnails a list cell shows before "+2". */
const THUMBNAILS = 3;

/** The files of a field, read-only: thumbnails for images, names that open the file for everything else. */
export function FileDisplay({ field, files, detailed = false, plain = false }: FileDisplayProps) {
  const t = useT();
  if (files.length === 0) return <>—</>;
  const image = (file: AdminFileRef) => field.widget === 'image' && file.contentType.startsWith('image/');
  const shown = detailed ? files : files.slice(0, THUMBNAILS);
  return (
    <span className={cn('inline-flex flex-wrap items-center', detailed ? 'gap-2' : 'gap-1 align-middle')}>
      {shown.map((file) => {
        const content = image(file) ? (
          <img src={file.url} alt={file.name} loading="lazy" className={cn('rounded-md border bg-muted object-cover', detailed ? 'size-24' : 'size-8')} />
        ) : (
          <>
            <FileIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <bdi className="max-w-48 truncate">{file.name}</bdi>
            {detailed && <span className="shrink-0 text-muted-foreground">{formatBytes(file.size)}</span>}
          </>
        );
        return plain ? (
          <span key={file.key} className="inline-flex min-w-0 items-center gap-1">
            {content}
          </span>
        ) : (
          // A row click opens the record; the file opens on its own.
          <a key={file.key} href={file.url} target="_blank" rel="noopener noreferrer" aria-label={t('upload.open', { name: file.name })} title={file.name} className="inline-flex min-w-0 items-center gap-1 hover:underline" onClick={(event) => event.stopPropagation()}>
            {content}
          </a>
        );
      })}
      {files.length > shown.length && <span className="text-xs text-muted-foreground">{t('upload.more', { count: files.length - shown.length })}</span>}
    </span>
  );
}

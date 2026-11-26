import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ImageOff, Star, TriangleAlert, X } from 'lucide-react';
import type { FieldSchema, FormLayoutInline, ResourceSchema } from '@nest-my-admin/core/contract';
import { DropZone, UploadProblems, UploadProgress } from '@/app/file-input';
import { useReorder, useUploads } from '@/app/use-uploads';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { fileValuesOf, type FileValue, type FormValues } from '@/lib/form-values';
import type { InlineErrors, InlineRow } from '@/lib/inline-changes';
import { cn } from '@/lib/utils';

interface InlineGalleryProps {
  inline: FormLayoutInline;
  child: ResourceSchema;
  rows: InlineRow[];
  onChange: (rows: InlineRow[]) => void;
  /** The inline's other fields (all but the picture), shown for the chosen picture. */
  fields: FieldSchema[];
  errors?: InlineErrors;
  canCreate: boolean;
  canRemove: (row: InlineRow) => boolean;
  /** Rows may be reordered (an `order` field the user may write). */
  ordered: boolean;
  /** `rows` with one new row per set of values appended (fresh keys, the child's defaults under the values). */
  append: (rows: InlineRow[], values: FormValues[]) => InlineRow[];
  /** A field of a row as the section renders it (input, read-only value or nothing). */
  renderField: (row: InlineRow, field: FieldSchema) => ReactNode;
  onBusy: (name: string, busy: boolean) => void;
}

/**
 * `display: 'gallery'`: an inline whose rows are pictures (a product's). One box of thumbnails: several files chosen
 * or dropped at once become a new row each, every thumbnail has remove and «make main» (first by `order`), they
 * reorder by dragging, and the other fields of the chosen thumbnail (alt text, variant) are edited below the box.
 * Nothing is saved here: the parent's Save sends the rows like any inline.
 */
export function InlineGallery({ inline, child, rows, onChange, fields, errors, canCreate, canRemove, ordered, append, renderField, onBusy }: InlineGalleryProps) {
  const t = useT();
  const imageField = child.fields.find((field) => field.name === inline.image)!;
  const rules = imageField.file ?? { accept: ['image/*'], maxBytes: Infinity };
  // Several files at a time, whatever the field itself holds: each one becomes a row of its own.
  const dropField: FieldSchema = { ...imageField, file: { ...rules, many: true } };
  const latest = useRef(rows);
  latest.current = rows;
  /** Local copies of new uploads by token: a private picture has no URL until the parent is saved. */
  const previews = useRef(new Map<string, string>());
  useEffect(
    () => () => {
      for (const url of previews.current.values()) URL.revokeObjectURL(url);
      previews.current.clear();
    },
    [],
  );
  const queue = useUploads({ resource: child.name, field: imageField, rules, onBusy: (busy) => onBusy(`${child.name}:gallery`, busy) });
  const [chosen, setChosen] = useState<string | null>(null);

  const emit = (next: InlineRow[]) => {
    latest.current = next;
    onChange(next);
  };
  const room = inline.max - rows.length - queue.pending.length;
  function add(files: File[]) {
    const accepted = files.slice(0, Math.max(0, room));
    if (accepted.length === 0) return;
    queue.start(accepted, (stored, _file, preview) => {
      if (preview) previews.current.set(stored.token, preview);
      const value: FileValue = { token: stored.token, name: stored.name, size: stored.size, contentType: stored.contentType, ...(stored.url ? { url: stored.url } : {}) };
      // Uploads finish one by one, outside React's render: each adds to the rows as they are by then.
      emit(append(latest.current, [{ [imageField.name]: value }]));
    });
  }
  function remove(key: string) {
    if (chosen === key) setChosen(null);
    emit(latest.current.filter((row) => row.key !== key));
  }
  function move(from: number, to: number) {
    const current = latest.current;
    if (to < 0 || to >= current.length || from === to) return;
    const moved = [...current];
    moved.splice(to, 0, moved.splice(from, 1)[0]!);
    emit(moved);
  }
  const reorder = useReorder(move);

  const rowErrors = (row: InlineRow) => errors?.rows[row.key] ?? {};
  const hasErrors = (row: InlineRow) => Object.keys(rowErrors(row)).length > 0;
  // A picture the server refused opens by itself, so its message is in view.
  const openKey = chosen ?? rows.find(hasErrors)?.key ?? null;
  const openIndex = rows.findIndex((row) => row.key === openKey);
  const open = openIndex === -1 ? undefined : rows[openIndex];
  const pictureOf = (row: InlineRow) => fileValuesOf(row.values[imageField.name])[0];
  const srcOf = (file: FileValue | undefined) => (file ? (file.url ?? (file.token ? previews.current.get(file.token) : undefined)) : undefined);
  const imageErrors = open ? (rowErrors(open)[imageField.name] ?? []) : [];

  return (
    <div className="flex flex-col gap-3" data-gallery={child.name}>
      {(rows.length > 0 || queue.pending.length > 0) && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3">
          {rows.map((row, index) => {
            const file = pictureOf(row);
            const src = srcOf(file);
            const name = t('inline.gallery.picture', { index: index + 1 });
            return (
              <li
                key={row.key}
                data-row={row.key}
                {...(ordered ? reorder.item(index) : {})}
                className={cn(
                  'relative aspect-square overflow-hidden rounded-lg border bg-muted',
                  ordered && 'cursor-grab',
                  openKey === row.key && 'border-primary ring-2 ring-primary/40',
                  hasErrors(row) && 'border-destructive ring-2 ring-destructive/40',
                  reorder.dragging === index && 'opacity-50',
                  reorder.over === index && reorder.dragging !== index && 'border-primary',
                )}
              >
                <button
                  type="button"
                  className="size-full focus-visible:outline-none"
                  aria-label={t('inline.gallery.select', { name })}
                  aria-pressed={openKey === row.key}
                  onClick={() => setChosen(openKey === row.key ? null : row.key)}
                >
                  {src ? (
                    <img src={src} alt={file?.name ?? ''} draggable={false} className="size-full object-cover" />
                  ) : (
                    <span className="flex size-full flex-col items-center justify-center gap-1 p-1 text-center text-xs text-muted-foreground">
                      <ImageOff className="size-5" aria-hidden />
                      {file && <bdi className="w-full truncate">{file.name}</bdi>}
                    </span>
                  )}
                </button>
                {index === 0 && inline.markFirst && (
                  <Badge tone="primary" className="pointer-events-none absolute start-1 bottom-1 bg-primary text-primary-foreground shadow">
                    {inline.markFirst}
                  </Badge>
                )}
                {hasErrors(row) && <TriangleAlert className="pointer-events-none absolute start-1 top-1 size-4 text-destructive" aria-hidden />}
                <div className="absolute end-1 top-1 flex flex-col gap-1">
                  {canRemove(row) && (
                    <Button type="button" variant="secondary" size="icon-xs" className="shadow" aria-label={t('inline.remove', { name })} onClick={() => remove(row.key)}>
                      <X />
                    </Button>
                  )}
                  {ordered && index > 0 && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon-xs"
                      className="shadow"
                      aria-label={t('inline.gallery.makeMain', { name })}
                      title={t('inline.gallery.makeMain', { name })}
                      onClick={() => move(index, 0)}
                    >
                      <Star />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
          {queue.pending.map((upload) => (
            <li key={`pending-${upload.id}`} className="relative aspect-square overflow-hidden rounded-lg border border-dashed bg-muted">
              {upload.preview && <img src={upload.preview} alt="" className="size-full object-cover opacity-40" />}
              <UploadProgress upload={upload} onCancel={() => queue.cancel(upload.id)} className="absolute inset-x-1 bottom-1 rounded-md bg-background/80 ps-1.5" />
            </li>
          ))}
        </ul>
      )}
      {canCreate && room > 0 && (
        <DropZone id={`inline-${child.name}-gallery`} field={dropField} label={t('inline.gallery.add')} onFiles={add} aria={{}} />
      )}
      {canCreate && room <= 0 && <p className="text-sm text-muted-foreground">{t('inline.gallery.full', { max: inline.max })}</p>}
      <UploadProblems problems={queue.problems} />
      {open && (fields.length > 0 || imageErrors.length > 0) && (
        <div className="flex flex-col gap-4 rounded-card border bg-background/40 p-4" data-gallery-details={open.key}>
          <span className="text-sm font-medium">{t('inline.gallery.details', { index: openIndex + 1 })}</span>
          {fields.map((field) => (
            <div key={field.name}>{renderField(open, field)}</div>
          ))}
          {imageErrors.length > 0 && (
            <p role="alert" className="text-sm text-destructive">
              {imageErrors.join(' — ')}
            </p>
          )}
        </div>
      )}
      {!open && rows.length > 0 && fields.length > 0 && <p className="text-xs text-muted-foreground">{t('inline.gallery.chooseHint')}</p>}
    </div>
  );
}

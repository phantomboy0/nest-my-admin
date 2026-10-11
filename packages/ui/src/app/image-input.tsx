import { ChevronLeft, ChevronRight, ImageOff, X } from 'lucide-react';
import { DropZone, UploadProblems, UploadProgress, type FileFieldProps } from '@/app/file-input';
import { useFileField, useReorder } from '@/app/use-uploads';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';

/**
 * An image field: a preview (from the stored file's URL, or the local copy of a new upload) with Remove, a gallery
 * to reorder for `many`, and a drop zone to add or replace.
 */
export function ImageInput(props: FileFieldProps) {
  const t = useT();
  const { id, field, aria } = props;
  const { many, files, pending, problems, add, remove, move, cancel, previewOf } = useFileField(props);
  const reorder = useReorder(move);
  const sortable = many && files.length > 1;
  return (
    <div className="flex flex-col gap-2">
      {(files.length > 0 || pending.length > 0) && (
        <ul className="flex flex-wrap gap-2">
          {files.map((file, index) => {
            const src = previewOf(file);
            return (
              <li
                key={file.token ?? file.key}
                data-file={file.name}
                {...(sortable ? reorder.item(index) : {})}
                className={cn(
                  'group relative size-28 overflow-hidden rounded-lg border bg-muted',
                  sortable && 'cursor-grab',
                  reorder.dragging === index && 'opacity-50',
                  reorder.over === index && reorder.dragging !== index && 'border-primary ring-2 ring-primary/40',
                )}
              >
                {src ? (
                  <img src={src} alt={file.name} draggable={false} className="size-full object-cover" />
                ) : (
                  <span className="flex size-full flex-col items-center justify-center gap-1 p-1 text-center text-xs text-muted-foreground">
                    <ImageOff className="size-5" aria-hidden />
                    <bdi className="w-full truncate">{file.name}</bdi>
                  </span>
                )}
                <Button type="button" variant="secondary" size="icon-xs" className="absolute end-1 top-1 shadow" aria-label={t('upload.remove', { name: file.name })} onClick={() => remove(index)}>
                  <X />
                </Button>
                {sortable && (
                  <div className="absolute inset-x-1 bottom-1 flex justify-between">
                    <Button type="button" variant="secondary" size="icon-xs" className="shadow" disabled={index === 0} aria-label={t('list.moveUp', { name: file.name })} onClick={() => move(index, index - 1)}>
                      <ChevronLeft className="rtl:rotate-180" />
                    </Button>
                    <Button type="button" variant="secondary" size="icon-xs" className="shadow" disabled={index === files.length - 1} aria-label={t('list.moveDown', { name: file.name })} onClick={() => move(index, index + 1)}>
                      <ChevronRight className="rtl:rotate-180" />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
          {pending.map((upload) => (
            <li key={`pending-${upload.id}`} className="relative size-28 overflow-hidden rounded-lg border border-dashed bg-muted">
              {upload.preview && <img src={upload.preview} alt="" className="size-full object-cover opacity-40" />}
              <UploadProgress upload={upload} onCancel={() => cancel(upload.id)} className="absolute inset-x-1 bottom-1 rounded-md bg-background/80 ps-1.5" />
            </li>
          ))}
        </ul>
      )}
      <DropZone id={id} field={field} label={t(many ? 'upload.chooseImages' : files.length > 0 ? 'upload.replace' : 'upload.chooseImage')} compact={!many && files.length > 0} onFiles={add} aria={aria} />
      <UploadProblems problems={problems} />
    </div>
  );
}

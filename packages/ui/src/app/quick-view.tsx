import { useRef } from 'react';
import { Link } from 'react-router';
import { Pencil, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import type { AdminRecord, FieldSchema, ResourceSchema } from '@nest-my-admin/core/contract';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { formatCell } from '@/lib/format';
import { useRecord } from '@/lib/queries';

interface QuickViewProps {
  schema: ResourceSchema;
  /** The row that was opened (shown at once; the full record replaces it when loaded). */
  item: AdminRecord | undefined;
  onClose: () => void;
}

/** A side sheet with the record's fields (spec §9.2): opened from a list row, closed with Escape. */
export function QuickView({ schema, item, onClose }: QuickViewProps) {
  const t = useT();
  // Where focus was when the sheet opened (the row), so closing puts it back there.
  const opener = useRef<HTMLElement | null>(null);
  if (item && !opener.current) opener.current = document.activeElement as HTMLElement | null;
  const id = item ? String(item._id) : undefined;
  const full = useRecord(schema.name, id);
  const record = full.data ?? item;
  const title = typeof record?._title === 'string' ? record._title : `#${id}`;
  const fields = schema.fields.filter((field) => field.persisted && !field.name.includes('.') && record !== undefined && Object.hasOwn(record, field.name));
  return (
    <Dialog.Root open={item !== undefined} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content
          className="fixed inset-y-0 end-0 z-50 flex w-full max-w-md flex-col border-s bg-background shadow-xl outline-none"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
            opener.current = null;
          }}
        >
          <div className="flex items-center gap-2 border-b p-4">
            <Dialog.Title className="min-w-0 flex-1 truncate text-lg font-semibold">{t('list.quickView', { name: title })}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t('list.close')}>
                <X />
              </Button>
            </Dialog.Close>
          </div>
          <dl className="grid flex-1 grid-cols-[minmax(6rem,auto)_1fr] content-start gap-x-4 gap-y-2 overflow-y-auto p-4 text-sm">
            {fields.map((field: FieldSchema) => (
              <div key={field.name} className="contents">
                <dt className="text-muted-foreground">{field.label}</dt>
                <dd className="break-words">{formatCell(record![field.name], field)}</dd>
              </div>
            ))}
          </dl>
          <div className="flex gap-2 border-t p-4">
            <Button asChild>
              <Link to={`/${schema.name}/${encodeURIComponent(id ?? '')}`}>
                <Pencil />
                {t('list.edit')}
              </Link>
            </Button>
            <Dialog.Close asChild>
              <Button variant="outline">{t('list.close')}</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

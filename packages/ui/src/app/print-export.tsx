import { useState } from 'react';
import { FileSpreadsheet, Printer } from 'lucide-react';
import type { PrintSchema, ResourceSchema } from '@nest-my-admin/core/contract';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { api, describeError, printUrl } from '@/lib/api';
import { iconNamed } from '@/lib/icons';
import { toast } from '@/lib/toast';

/** Print templates for these records: each opens its page in a new tab, which prints itself. */
export function PrintButtons({ schema, ids, bulkOnly = false, size = 'default' }: { schema: ResourceSchema; ids: string[]; bulkOnly?: boolean; size?: 'default' | 'sm' }) {
  const t = useT();
  const prints = (schema.prints ?? []).filter((print: PrintSchema) => !bulkOnly || print.bulk);
  if (ids.length === 0 || prints.length === 0) return null;
  return (
    <>
      {prints.map((print) => {
        const Icon = iconNamed(print.icon) ?? Printer;
        return (
          <Button key={print.name} type="button" variant="outline" size={size} aria-label={t('print.open', { name: print.label })} onClick={() => window.open(printUrl(schema.name, print.name, ids), '_blank', 'noopener')}>
            <Icon />
            {print.label}
          </Button>
        );
      })}
    </>
  );
}

/** «Export to Excel» for the list as filtered now: downloads the file, and says when it was cut at the row cap. */
export function ExportButton({ schema, query, iconOnly = false }: { schema: ResourceSchema; query: URLSearchParams; iconOnly?: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  if (!schema.list.export) return null;
  async function run() {
    setBusy(true);
    try {
      const { blob, filename, truncated } = await api.exportList(schema.name, query);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast(truncated ? t('list.exportTruncated', { count: truncated }) : t('list.exportDone', { file: filename }), truncated ? 'error' : 'success');
    } catch (error) {
      toast(describeError(error as Error), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button type="button" variant="outline" size={iconOnly ? 'icon' : 'default'} disabled={busy} aria-label={iconOnly ? t('list.export') : undefined} onClick={() => void run()}>
      <FileSpreadsheet />
      {!iconOnly && t(busy ? 'list.exporting' : 'list.export')}
    </Button>
  );
}

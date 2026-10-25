import type { AdminRecord, FieldSchema } from '@nest-my-admin/core/contract';
import { FileDisplay } from '@/app/file-display';
import { fileRefsOf } from '@/lib/form-values';
import { formatCell } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { toneOf } from '@/lib/tones';

/** A value as a coloured pill (the `badge` widget): the colour from `field.colors`, gray when none is set. */
export function ValueBadge({ value, field, className }: { value: unknown; field: FieldSchema; className?: string }) {
  if (value === null || value === undefined) return <>{formatCell(value, field)}</>;
  const color = field.colors?.[String(value)] ?? 'gray';
  return (
    <Badge data-color={color} tone={toneOf(color)} className={className}>
      {formatCell(value, field)}
    </Badge>
  );
}

/**
 * A value for display: a badge for badge fields, thumbnails and file names for file fields (from the `record`'s
 * `_files`), else the formatted text.
 */
export function DisplayValue({ value, field, record, detailed, plain }: { value: unknown; field: FieldSchema; record?: AdminRecord; detailed?: boolean; plain?: boolean }) {
  if (field.file && record) return <FileDisplay field={field} files={fileRefsOf(record, field.name)} detailed={detailed} plain={plain} />;
  return field.widget === 'badge' ? <ValueBadge value={value} field={field} /> : <>{formatCell(value, field)}</>;
}

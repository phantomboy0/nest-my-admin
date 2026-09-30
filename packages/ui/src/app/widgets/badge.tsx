import type { FieldSchema } from '@nest-my-admin/core/contract';
import { formatCell } from '@/lib/format';
import { cn } from '@/lib/utils';

type BadgeColor = NonNullable<FieldSchema['colors']>[string];

const PALETTE: Record<BadgeColor, string> = {
  gray: 'bg-muted text-muted-foreground',
  red: 'bg-red-500/15 text-red-700 dark:text-red-300',
  amber: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  green: 'bg-green-500/15 text-green-800 dark:text-green-300',
  blue: 'bg-blue-500/15 text-blue-800 dark:text-blue-300',
  purple: 'bg-purple-500/15 text-purple-800 dark:text-purple-300',
  pink: 'bg-pink-500/15 text-pink-800 dark:text-pink-300',
};

/** A value as a coloured pill (the `badge` widget): the colour from `field.colors`, gray when none is set. */
export function ValueBadge({ value, field, className }: { value: unknown; field: FieldSchema; className?: string }) {
  if (value === null || value === undefined) return <>{formatCell(value, field)}</>;
  const color = field.colors?.[String(value)] ?? 'gray';
  return (
    <span data-color={color} className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', PALETTE[color], className)}>
      {formatCell(value, field)}
    </span>
  );
}

/** A value for display: a badge for badge fields, else the formatted text. */
export function DisplayValue({ value, field }: { value: unknown; field: FieldSchema }) {
  return field.widget === 'badge' ? <ValueBadge value={value} field={field} /> : <>{formatCell(value, field)}</>;
}

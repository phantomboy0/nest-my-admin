import type { ReactNode } from 'react';
import type { FieldConstraints, FieldSchema } from '@nest-my-admin/core/contract';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface FieldInputProps {
  field: FieldSchema;
  constraints?: FieldConstraints;
  value: string | boolean | undefined;
  required: boolean;
  errors?: string[];
  onChange: (value: string | boolean) => void;
}

const selectClass =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive';

export function FieldInput({ field, value, required, errors, constraints, onChange }: FieldInputProps) {
  const id = `field-${field.name}`;
  const errorId = `${id}-error`;
  const invalid = (errors?.length ?? 0) > 0;
  const aria = { 'aria-invalid': invalid || undefined, 'aria-describedby': invalid ? errorId : undefined };
  const text = typeof value === 'string' ? value : '';

  const label = (
    <Label htmlFor={id}>
      {field.label}
      {required && (
        <span aria-hidden className="text-destructive">
          *
        </span>
      )}
    </Label>
  );

  if (field.type === 'boolean') {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <input id={id} type="checkbox" className="size-4 accent-primary" checked={value === true} onChange={(e) => onChange(e.target.checked)} {...aria} />
          {label}
        </div>
        <FieldErrors id={errorId} errors={errors} />
      </div>
    );
  }

  let control: ReactNode;
  if (field.type === 'enum') {
    control = (
      <select id={id} className={selectClass} value={text} onChange={(e) => onChange(e.target.value)} {...aria}>
        <option value="">—</option>
        {field.enumValues?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  } else if (field.type === 'text' || field.type === 'json') {
    control = (
      <Textarea
        id={id}
        value={text}
        rows={field.type === 'json' ? 6 : 4}
        className={cn(field.type === 'json' && 'font-mono')}
        onChange={(e) => onChange(e.target.value)}
        {...aria}
      />
    );
  } else {
    control = <Input id={id} value={text} onChange={(e) => onChange(e.target.value)} {...inputProps(field, constraints)} {...aria} />;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label}
      {control}
      <FieldErrors id={errorId} errors={errors} />
    </div>
  );
}

/** Numeric fields use text inputs with inputMode: a controlled type="number" can drop focus on mobile keyboards. */
function inputProps(field: FieldSchema, constraints?: FieldConstraints): { type: string; inputMode?: 'decimal' | 'numeric' } {
  switch (field.type) {
    case 'number':
    case 'decimal':
      return { type: 'text', inputMode: 'decimal' };
    case 'bigint':
      return { type: 'text', inputMode: 'numeric' };
    case 'date':
      return { type: 'date' };
    case 'datetime':
      return { type: 'datetime-local' };
    default:
      return { type: constraints?.format === 'email' ? 'email' : constraints?.format === 'url' ? 'url' : 'text' };
  }
}

function FieldErrors({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p id={id} className="text-sm text-destructive">
      {errors.join(' ')}
    </p>
  );
}

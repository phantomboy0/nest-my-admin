import { useState, type ComponentProps, type ReactNode } from 'react';
import type { FieldSchema } from '@nest-my-admin/core/contract';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/i18n';
import { groupMoney } from '@/lib/money';
import { cn } from '@/lib/utils';
import { enumLabel } from '@/lib/widgets';

/** What every widget gets: the input id, the ARIA wiring for help and errors, and the value as text. */
export interface WidgetProps {
  id: string;
  field: FieldSchema;
  value: string;
  onChange: (value: string) => void;
  aria: { 'aria-invalid'?: true; 'aria-describedby'?: string };
}

/** A decimal as text with thousands grouped when the input is left (the payload drops the commas again). */
export function MoneyInput({ id, field, value, onChange, aria }: WidgetProps) {
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        dir="ltr"
        className="text-end"
        value={value}
        placeholder={field.placeholder}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => onChange(groupMoney(value, field.scale))}
        {...aria}
      />
      {field.currency && <span className="text-sm text-muted-foreground">{field.currency}</span>}
    </div>
  );
}

/** An on/off switch: a button with `role="switch"`, so Space toggles it and screen readers say on or off. */
export function SwitchInput({ id, checked, onChange, aria }: { id: string; checked: boolean; onChange: (value: boolean) => void; aria: WidgetProps['aria'] }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        checked ? 'bg-primary' : 'bg-input',
      )}
      {...aria}
    >
      <span className={cn('block size-4 rounded-full bg-background shadow transition-transform', checked ? 'translate-x-4 rtl:-translate-x-4' : 'translate-x-0')} />
    </button>
  );
}

/** Enum values as radio buttons; `required` fields get no empty choice. */
export function RadioInput({ id, field, value, onChange, aria, label, required }: WidgetProps & { label: ReactNode; required: boolean }) {
  const t = useT();
  const options: Array<[string, string]> = (field.enumValues ?? []).map((option) => [option, enumLabel(field, option)]);
  if (field.nullable && !required) options.unshift(['', t('common.empty')]);
  return (
    <fieldset id={id} className="flex flex-col gap-1.5" {...aria}>
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div role="radiogroup" className="flex flex-wrap gap-x-4 gap-y-1.5">
        {options.map(([option, text]) => (
          <label key={option} className="flex items-center gap-1.5 text-sm">
            <input type="radio" name={id} value={option} checked={value === option} onChange={() => onChange(option)} className="size-4 accent-primary" />
            {text}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

/** A colour swatch next to its hex code; either one edits the value. */
export function ColorInput({ id, field, value, onChange, aria }: WidgetProps) {
  const t = useT();
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-hidden
        tabIndex={-1}
        className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
        value={HEX.test(value) ? value.toLowerCase() : '#000000'}
        onChange={(event) => onChange(event.target.value)}
      />
      <Input id={id} dir="ltr" value={value} placeholder={field.placeholder ?? '#000000'} aria-label={t('form.colorCode', { name: field.label })} onChange={(event) => onChange(event.target.value)} {...aria} />
    </div>
  );
}

/** JSON in a monospace box with a Format button; a parse error shows under it (the save reports it too). */
export function JsonInput({ id, field, value, onChange, aria }: WidgetProps) {
  const t = useT();
  const [problem, setProblem] = useState<string | null>(null);
  const problemId = `${id}-json`;
  function format() {
    if (value.trim() === '') return;
    try {
      onChange(JSON.stringify(JSON.parse(value), null, 2));
      setProblem(null);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }
  const describedBy = [aria['aria-describedby'], problem ? problemId : undefined].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Textarea
        id={id}
        dir="ltr"
        rows={6}
        className="font-mono"
        spellCheck={false}
        value={value}
        placeholder={field.placeholder}
        onChange={(event) => {
          setProblem(null);
          onChange(event.target.value);
        }}
        {...aria}
        aria-invalid={aria['aria-invalid'] ?? (problem ? true : undefined)}
        aria-describedby={describedBy}
      />
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={format}>
          {t('form.formatJson')}
        </Button>
        {problem && (
          <p id={problemId} className="text-sm text-destructive">
            {problem}
          </p>
        )}
      </div>
    </div>
  );
}

export function PlainTextarea({ id, field, value, onChange, aria }: WidgetProps) {
  return <Textarea id={id} rows={4} value={value} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} {...aria} />;
}

export function TextInput({ id, field, value, onChange, aria, ...rest }: WidgetProps & Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'id'>) {
  return <Input id={id} value={value} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} {...rest} {...aria} />;
}

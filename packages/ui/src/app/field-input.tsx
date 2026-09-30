import type { ReactNode } from 'react';
import type { FieldConstraints, FieldSchema } from '@nest-my-admin/core/contract';
import { DateInput, DateTimeInput } from '@/app/date-input';
import { RelationInput, type RelationValue } from '@/app/relation-input';
import { ColorInput, JsonInput, MoneyInput, PlainTextarea, RadioInput, SwitchInput, TextInput } from '@/app/widgets/inputs';
import { Label } from '@/components/ui/label';
import type { FormValue } from '@/lib/form-values';
import { enumLabel, widgetOf } from '@/lib/widgets';

interface FieldInputProps {
  /** The resource being edited (relation pickers load their options through it). */
  resource: string;
  field: FieldSchema;
  constraints?: FieldConstraints;
  value: FormValue | undefined;
  required: boolean;
  errors?: string[];
  /** The form's current values as JSON, for relation pickers whose options depend on them. */
  formValues?: string;
  onChange: (value: FormValue) => void;
}

const selectClass =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive';

/** One field of a form: its label, the widget (`field.widget`, else inferred from the type), help and errors. */
export function FieldInput({ resource, field, value, required, errors, constraints, formValues, onChange }: FieldInputProps) {
  const id = `field-${field.name}`;
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const invalid = (errors?.length ?? 0) > 0;
  const describedBy = [field.help ? helpId : undefined, invalid ? errorId : undefined].filter(Boolean).join(' ') || undefined;
  const aria = { 'aria-invalid': invalid ? (true as const) : undefined, 'aria-describedby': describedBy };
  const text = typeof value === 'string' ? value : '';
  const widget = field.type === 'relation' ? undefined : widgetOf(field, constraints);

  const labelText = (
    <>
      {field.label}
      {required && (
        <span aria-hidden className="text-destructive">
          *
        </span>
      )}
    </>
  );
  const label = <Label htmlFor={id}>{labelText}</Label>;
  const help = field.help ? (
    <p id={helpId} className="text-sm text-muted-foreground">
      {field.help}
    </p>
  ) : null;
  const widgetProps = { id, field, value: text, onChange: (next: string) => onChange(next), aria };

  if (field.type === 'boolean') {
    const checked = value === true;
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          {widget === 'switch' ? (
            <SwitchInput id={id} checked={checked} onChange={onChange} aria={aria} />
          ) : (
            <input id={id} type="checkbox" className="size-4 accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} {...aria} />
          )}
          {label}
        </div>
        {help}
        <FieldErrors id={errorId} errors={errors} />
      </div>
    );
  }

  if (field.type === 'enum' && widget === 'radio') {
    return (
      <div className="flex flex-col gap-1.5">
        <RadioInput {...widgetProps} label={labelText} required={required} />
        {help}
        <FieldErrors id={errorId} errors={errors} />
      </div>
    );
  }

  let control: ReactNode;
  if (field.type === 'relation') {
    control = (
      <RelationInput
        id={id}
        resource={resource}
        field={field}
        value={(value ?? null) as RelationValue}
        onChange={onChange}
        clearable={field.nullable}
        values={formValues}
        invalid={invalid}
        describedBy={describedBy}
      />
    );
  } else if (field.type === 'enum') {
    control = (
      <select id={id} className={selectClass} value={text} onChange={(e) => onChange(e.target.value)} {...aria}>
        <option value="">{field.placeholder ?? '—'}</option>
        {field.enumValues?.map((option) => (
          <option key={option} value={option}>
            {enumLabel(field, option)}
          </option>
        ))}
      </select>
    );
  } else {
    switch (widget) {
      case 'money':
        control = <MoneyInput {...widgetProps} />;
        break;
      case 'date':
        control = <DateInput id={id} live value={text} label={field.label} onChange={(next) => onChange(next)} {...aria} />;
        break;
      case 'datetime':
        control = <DateTimeInput id={id} value={text} label={field.label} onChange={(next) => onChange(next)} {...aria} />;
        break;
      case 'json':
        control = <JsonInput {...widgetProps} />;
        break;
      case 'textarea':
        control = <PlainTextarea {...widgetProps} />;
        break;
      case 'color':
        control = <ColorInput {...widgetProps} />;
        break;
      case 'password':
        control = <TextInput {...widgetProps} type="password" autoComplete="new-password" />;
        break;
      case 'slug':
        control = <TextInput {...widgetProps} dir="ltr" autoCapitalize="none" spellCheck={false} />;
        break;
      default:
        control = <TextInput {...widgetProps} {...inputProps(field, widget)} />;
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label}
      {control}
      {help}
      <FieldErrors id={errorId} errors={errors} />
    </div>
  );
}

/** Numeric fields use text inputs with inputMode: a controlled type="number" can drop focus on mobile keyboards. */
function inputProps(field: FieldSchema, widget: string | undefined): { type: string; inputMode?: 'decimal' | 'numeric' } {
  if (widget === 'email' || widget === 'url') return { type: widget };
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
      return { type: 'text' };
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

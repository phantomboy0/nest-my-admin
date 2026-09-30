import { Plus, Trash2 } from 'lucide-react';
import type { FieldConstraints, FieldSchema } from '@nest-my-admin/core/contract';
import { FieldInput } from '@/app/field-input';
import { Button } from '@/components/ui/button';
import { toFormValues, type FormValue, type FormValues } from '@/lib/form-values';

interface ObjectInputProps {
  resource: string;
  field: FieldSchema;
  /** Dotted path of the field (`address`, `hours.1`); error and input ids use it. */
  path: string;
  /** Constraint key of the field: the path with list indexes as `*` (`hours.*`). */
  pattern: string;
  value: FormValue | undefined;
  constraints: Record<string, FieldConstraints>;
  /** Show `required` marks (create forms). */
  markRequired: boolean;
  errors: Record<string, string[]>;
  onChange: (value: FormValue) => void;
}

const asGroup = (value: FormValue | undefined): FormValues =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as FormValues) : {};

/** A sub-form (embedded entity or nested DTO), or a list of them with Add and Remove when the field is `many`. */
export function ObjectInput({ resource, field, path, pattern, value, constraints, markRequired, errors, onChange }: ObjectInputProps) {
  const own = errors[path];
  if (field.many) {
    const items = Array.isArray(value) ? (value as FormValues[]) : [];
    return (
      <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">{field.label}</legend>
        {items.map((item, index) => (
          <div key={index} className="flex flex-col gap-3 rounded-md border border-dashed p-3">
            <Group
              resource={resource}
              field={field}
              path={`${path}.${index}`}
              pattern={`${pattern}.*`}
              value={item}
              constraints={constraints}
              markRequired={markRequired}
              errors={errors}
              onChange={(next) => onChange(items.map((existing, at) => (at === index ? next : existing)))}
            />
            <div>
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange(items.filter((_, at) => at !== index))}>
                <Trash2 />
                Remove {field.label.toLowerCase()} {index + 1}
              </Button>
            </div>
          </div>
        ))}
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, toFormValues(field.fields ?? [])])}>
            <Plus />
            Add {field.label.toLowerCase()}
          </Button>
        </div>
        {own && <p className="text-sm text-destructive">{own.join(' ')}</p>}
      </fieldset>
    );
  }
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">{field.label}</legend>
      <Group
        resource={resource}
        field={field}
        path={path}
        pattern={pattern}
        value={asGroup(value)}
        constraints={constraints}
        markRequired={markRequired}
        errors={errors}
        onChange={onChange}
      />
      {own && <p className="text-sm text-destructive">{own.join(' ')}</p>}
    </fieldset>
  );
}

type GroupProps = Omit<ObjectInputProps, 'value' | 'onChange'> & { value: FormValues; onChange: (value: FormValues) => void };

function Group({ resource, field, path, pattern, value, constraints, markRequired, errors, onChange }: GroupProps) {
  return (
    <>
      {(field.fields ?? [])
        .filter((child) => !child.readonly)
        .map((child) => {
          const childPath = `${path}.${child.name}`;
          const childPattern = `${pattern}.${child.name}`;
          const set = (next: FormValue) => onChange({ ...value, [child.name]: next });
          return child.type === 'object' ? (
            <ObjectInput
              key={child.name}
              resource={resource}
              field={child}
              path={childPath}
              pattern={childPattern}
              value={value[child.name]}
              constraints={constraints}
              markRequired={markRequired}
              errors={errors}
              onChange={set}
            />
          ) : (
            <FieldInput
              key={child.name}
              resource={resource}
              field={{ ...child, name: childPath }}
              value={value[child.name]}
              required={markRequired && constraints[childPattern]?.required === true}
              errors={errors[childPath]}
              constraints={constraints[childPattern]}
              onChange={set}
            />
          );
        })}
    </>
  );
}

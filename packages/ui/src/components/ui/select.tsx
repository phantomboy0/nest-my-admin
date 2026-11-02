import type { ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Select as RadixSelect } from 'radix-ui';
import { isRtl, useLocale } from '@/i18n';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: ReactNode;
  /** The option's own language (a language picker names each language in itself). */
  lang?: string;
}

interface SelectProps {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  /** Shown when nothing is chosen (`value` is not one of the options). */
  placeholder?: ReactNode;
  disabled?: boolean;
  /** `sm`: toolbars, table cells and the pager. */
  size?: 'sm' | 'md';
  className?: string;
  /** Opens at once (an inline cell edit). */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  autoFocus?: boolean;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'aria-busy'?: boolean;
}

// Radix keeps "" for «no value», so an option whose value is "" (All, Any, —) is carried under this one.
const EMPTY = '\u0000nma-empty';
const toRadix = (value: string) => (value === '' ? EMPTY : value);
const fromRadix = (value: string) => (value === EMPTY ? '' : value);

/**
 * The dashboard's dropdown (never the browser's own): a button that opens a list in the app's style, keyboard and
 * screen-reader friendly (Radix Select: arrows, typeahead, Escape), right to left where the language is. A label's
 * `htmlFor={id}` names it as it named a native select.
 */
export function Select({ id, value, onValueChange, options, placeholder, disabled, size = 'md', className, defaultOpen, onOpenChange, autoFocus, ...aria }: SelectProps) {
  const { locale } = useLocale();
  const known = options.some((option) => option.value === value);
  return (
    <RadixSelect.Root
      value={known ? toRadix(value) : ''}
      onValueChange={(next) => onValueChange(fromRadix(next))}
      disabled={disabled}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      dir={isRtl(locale) ? 'rtl' : 'ltr'}
    >
      <RadixSelect.Trigger
        id={id}
        autoFocus={autoFocus}
        data-slot="select"
        data-value={known ? value : undefined}
        className={cn(
          'flex w-full min-w-0 items-center justify-between gap-2 rounded-control border border-input bg-card px-2.5 text-start text-[13px] text-foreground outline-none transition-colors',
          'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
          'aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[placeholder]:text-muted-foreground',
          size === 'sm' ? 'h-7 text-xs' : 'h-8',
          className,
        )}
        aria-label={aria['aria-label']}
        aria-invalid={aria['aria-invalid']}
        aria-describedby={aria['aria-describedby']}
        aria-busy={aria['aria-busy']}
      >
        <span className="truncate">
          <RadixSelect.Value placeholder={placeholder ?? '—'} />
        </span>
        <RadixSelect.Icon asChild>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="relative z-[60] max-h-[min(var(--radix-select-content-available-height),320px)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-control border border-border bg-card text-card-foreground shadow-[0_12px_32px_rgba(0,0,0,.14)] data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={toRadix(option.value)}
                data-value={option.value}
                lang={option.lang}
                className="relative flex cursor-default select-none items-center gap-2 rounded-md py-1.5 ps-7 pe-2.5 text-[13px] outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <span className="absolute start-2 flex size-3.5 items-center justify-center">
                  <RadixSelect.ItemIndicator>
                    <Check className="size-3.5" aria-hidden />
                  </RadixSelect.ItemIndicator>
                </span>
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

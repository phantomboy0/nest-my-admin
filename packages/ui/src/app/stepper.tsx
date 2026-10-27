import { Check } from 'lucide-react';
import type { FieldSchema } from '@nest-my-admin/core/contract';
import { Card } from '@/components/ui/card';
import { formatNumber } from '@/i18n';
import { stepperModel } from '@/lib/stepper';
import { cn } from '@/lib/utils';

/**
 * An ordered status field as the order's steps (spec §5.7): done steps filled with a check, the current one ringed in
 * the accent with «since HH:MM», the rest muted and numbered; under each, when it was reached (or —). Phones scroll it.
 */
export function Stepper({ field, value, reached }: { field: FieldSchema; value: unknown; reached: Record<string, string | null> | undefined }) {
  const steps = stepperModel(field, value, reached);
  return (
    <Card aria-label={field.label} bodyClassName="overflow-x-auto px-5 py-4">
      <ol className="flex min-w-max">
        {steps.map((step, index) => (
          <li key={step.key} aria-current={step.state === 'current' ? 'step' : undefined} className="relative flex min-w-28 flex-1 flex-col items-center gap-1.5 text-center">
            {/* The line to the next step: accent once this step is done. */}
            {index < steps.length - 1 && (
              <span aria-hidden className={cn('absolute start-1/2 top-3.5 h-0.5 w-full', step.state === 'done' ? 'bg-primary' : 'bg-border')} />
            )}
            <span
              className={cn(
                'relative z-10 flex size-7 items-center justify-center rounded-full border-2 bg-card text-xs font-semibold',
                step.state === 'done' && 'border-primary bg-primary text-primary-foreground',
                step.state === 'current' && 'border-primary text-primary',
                step.state === 'future' && 'border-border text-muted-foreground',
              )}
            >
              {step.state === 'done' ? <Check className="size-3.5" aria-hidden /> : formatNumber(index + 1)}
            </span>
            <span className={cn('text-[13px]', step.state === 'current' ? 'font-semibold text-primary' : step.state === 'done' ? 'font-semibold' : 'text-muted-foreground')}>{step.label}</span>
            <span className="text-[11.5px] text-muted-foreground">{step.caption ?? step.at ?? '—'}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

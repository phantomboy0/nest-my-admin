import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Popover } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDate, formatNumberText, isRtl, useLocale } from '@/i18n';
import { toLatinDigits } from '@/lib/digits';
import { addDays, addJalaliMonths, formatJalali, fromJalali, jalaliMonthLength, parseJalali, toJalali, todayIso } from '@/lib/jalali';
import { cn } from '@/lib/utils';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

interface DateInputProps {
  id: string;
  /** ISO `YYYY-MM-DD`, '' for none (or, while typing in a form, the text that does not parse yet). */
  value: string;
  onChange: (value: string) => void;
  /** The field's name, for the calendar button's label. */
  label: string;
  /**
   * Forms: every keystroke reports (a valid date as ISO, anything else as typed, so the form can say it is invalid).
   * Filters: only a picked day, Enter or leaving the input reports, and only valid dates.
   */
  live?: boolean;
  className?: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
  autoFocus?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
}

/**
 * A date in the chosen calendar: the browser's date input for Gregorian; for Jalali a text input (`1403/01/15`, any
 * digits) next to a calendar with day, month and year views. The value is always an ISO date.
 */
export function DateInput(props: DateInputProps) {
  const { calendar } = useLocale();
  if (calendar === 'persian') return <JalaliInput {...props} />;
  const { id, value, onChange, live, className, label: _label, ...rest } = props;
  return <GregorianInput id={id} value={value} onChange={onChange} live={live} className={className} {...rest} />;
}

function GregorianInput({ id, value, onChange, live, className, ...rest }: Omit<DateInputProps, 'label'>) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Input
      id={id}
      type="date"
      className={className}
      value={live ? value : draft}
      onChange={(event) => (live ? onChange(event.target.value) : setDraft(event.target.value))}
      {...rest}
      onBlur={() => {
        if (!live && draft !== value) onChange(draft);
        rest.onBlur?.();
      }}
      onKeyDown={(event) => {
        if (!live && event.key === 'Enter') {
          event.preventDefault();
          if (draft !== value) onChange(draft);
        }
        rest.onKeyDown?.(event);
      }}
    />
  );
}

function JalaliInput({ id, value, onChange, label, live, className, ...rest }: DateInputProps) {
  const { t, digits } = useLocale();
  const shown = (iso: string) => (ISO.test(iso) ? formatNumberText(formatJalali(iso)) : iso);
  const [text, setText] = useState(() => shown(value));
  const [open, setOpen] = useState(false);
  const reported = useRef(value);
  // A new value from outside (a reset, a picked day, "Load theirs") replaces the text.
  useEffect(() => {
    if (value !== reported.current) {
      reported.current = value;
      setText(shown(value));
    }
  }, [value, digits]);

  function report(next: string) {
    reported.current = next;
    onChange(next);
  }

  function commitText() {
    const trimmed = text.trim();
    if (trimmed === '') return value !== '' && report('');
    const iso = parseJalali(trimmed);
    if (iso) {
      setText(shown(iso));
      if (iso !== value) report(iso);
    } else if (live) report(toLatinDigits(trimmed));
  }

  function pick(iso: string) {
    setText(shown(iso));
    setOpen(false);
    report(iso);
  }

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Input
        id={id}
        dir="ltr"
        inputMode="numeric"
        placeholder={formatNumberText('1403/01/15')}
        value={text}
        {...rest}
        onChange={(event) => {
          setText(event.target.value);
          if (!live) return;
          const trimmed = event.target.value.trim();
          const iso = trimmed === '' ? '' : parseJalali(trimmed);
          report(iso ?? toLatinDigits(trimmed));
        }}
        onBlur={() => {
          commitText();
          rest.onBlur?.();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commitText();
            if (!live) event.preventDefault();
          }
          rest.onKeyDown?.(event);
        }}
      />
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button type="button" variant="outline" size="icon-sm" aria-label={t('date.openCalendar', { name: label })}>
            <CalendarDays />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="end" sideOffset={4} className="z-50 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md" aria-label={t('date.calendar', { name: label })}>
            <JalaliCalendar value={ISO.test(value) ? value : undefined} onPick={pick} onClear={() => pick('')} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

type View = 'days' | 'months' | 'years';

/** Jalali month grid (weeks start on Saturday), drilling up to months and years. */
function JalaliCalendar({ value, onPick, onClear }: { value?: string; onPick: (iso: string) => void; onClear: () => void }) {
  const { t, locale } = useLocale();
  const today = todayIso();
  const [focused, setFocused] = useState(value ?? today);
  const [view, setView] = useState<View>('days');
  const grid = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const { jy, jm } = toJalali(focused);
  const rtl = isRtl(locale);

  // After a keyboard move, focus follows the day.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-iso="${focused}"]`)?.focus();
  }, [focused]);

  const monthName = (month: number) => new Intl.DateTimeFormat(`${locale}-u-ca-persian`, { month: 'long', timeZone: 'UTC' }).format(Date.parse(`${fromJalali(1403, month, 1)}T00:00:00Z`));
  const number = (n: number) => formatNumberText(String(n));
  // 1403/01/04 was a Saturday.
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(Date.parse(`${addDays(fromJalali(1403, 1, 4), i)}T00:00:00Z`)),
  );
  const first = fromJalali(jy, jm, 1);
  const offset = (new Date(`${first}T00:00:00Z`).getUTCDay() + 1) % 7; // Saturday = 0
  const days = jalaliMonthLength(jy, jm);
  const cells: Array<string | null> = [...Array.from({ length: offset }, () => null), ...Array.from({ length: days }, (_, i) => addDays(first, i))];

  function onGridKey(event: KeyboardEvent) {
    const steps: Record<string, number> = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: 7, ArrowUp: -7 };
    let next: string | undefined;
    if (event.key in steps) next = addDays(focused, steps[event.key]!);
    else if (event.key === 'PageDown') next = addJalaliMonths(focused, event.shiftKey ? 12 : 1);
    else if (event.key === 'PageUp') next = addJalaliMonths(focused, event.shiftKey ? -12 : -1);
    if (!next) return;
    event.preventDefault();
    moved.current = true;
    setFocused(next);
  }

  const header = (title: string, onTitle: (() => void) | undefined, step: (direction: 1 | -1) => void, titleLabel: string) => (
    <div className="mb-2 flex items-center justify-between gap-2">
      <Button type="button" variant="ghost" size="icon-sm" aria-label={t('date.previous')} onClick={() => step(-1)}>
        <ChevronLeft className="rtl:rotate-180" />
      </Button>
      {onTitle ? (
        <Button type="button" variant="ghost" size="sm" aria-label={titleLabel} onClick={onTitle}>
          {title}
        </Button>
      ) : (
        <span className="text-sm font-medium">{title}</span>
      )}
      <Button type="button" variant="ghost" size="icon-sm" aria-label={t('date.next')} onClick={() => step(1)}>
        <ChevronRight className="rtl:rotate-180" />
      </Button>
    </div>
  );

  let body;
  if (view === 'years') {
    const start = jy - (jy % 12);
    body = (
      <>
        {header(`${number(start)}–${number(start + 11)}`, undefined, (direction) => setFocused(addJalaliMonths(focused, direction * 144)), '')}
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 12 }, (_, i) => start + i).map((year) => (
            <Button
              key={year}
              type="button"
              variant={year === jy ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => {
                setFocused(fromJalali(year, jm, Math.min(toJalali(focused).jd, jalaliMonthLength(year, jm))));
                setView('months');
              }}
            >
              {number(year)}
            </Button>
          ))}
        </div>
      </>
    );
  } else if (view === 'months') {
    body = (
      <>
        {header(number(jy), () => setView('years'), (direction) => setFocused(addJalaliMonths(focused, direction * 12)), t('date.chooseYear'))}
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
            <Button
              key={month}
              type="button"
              variant={month === jm ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => {
                setFocused(fromJalali(jy, month, Math.min(toJalali(focused).jd, jalaliMonthLength(jy, month))));
                setView('days');
              }}
            >
              {monthName(month)}
            </Button>
          ))}
        </div>
      </>
    );
  } else {
    body = (
      <>
        {header(`${monthName(jm)} ${number(jy)}`, () => setView('months'), (direction) => setFocused(addJalaliMonths(focused, direction)), t('date.chooseMonth'))}
        <div ref={grid} role="grid" aria-label={`${monthName(jm)} ${number(jy)}`} onKeyDown={onGridKey} className="grid grid-cols-7 gap-0.5 text-center">
          <div role="row" className="contents">
            {weekdays.map((day, i) => (
              <div key={i} role="columnheader" className="py-1 text-xs text-muted-foreground">
                {day}
              </div>
            ))}
          </div>
          {Array.from({ length: Math.ceil(cells.length / 7) }, (_, row) => (
            <div key={row} role="row" className="contents">
              {cells.slice(row * 7, row * 7 + 7).map((iso, i) =>
                iso ? (
                  <div key={iso} role="gridcell" aria-selected={iso === value}>
                    <button
                      type="button"
                      data-iso={iso}
                      tabIndex={iso === focused ? 0 : -1}
                      aria-label={formatDate(iso)}
                      aria-current={iso === today ? 'date' : undefined}
                      onClick={() => onPick(iso)}
                      className={cn(
                        'size-8 rounded-md text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                        iso === today && 'font-semibold text-primary',
                        iso === value && 'bg-primary text-primary-foreground hover:bg-primary/90',
                      )}
                    >
                      {number(toJalali(iso).jd)}
                    </button>
                  </div>
                ) : (
                  <div key={`empty-${row}-${i}`} role="gridcell" />
                ),
              )}
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <div className="flex w-64 flex-col">
      {body}
      <div className="mt-2 flex justify-between gap-2 border-t pt-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => onPick(today)}>
          {t('date.today')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          {t('date.clear')}
        </Button>
      </div>
    </div>
  );
}

/** A datetime (`YYYY-MM-DDTHH:mm`, local) as a date in the chosen calendar plus a time. */
export function DateTimeInput({ id, value, onChange, label, ...aria }: { id: string; value: string; onChange: (value: string) => void; label: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) {
  const { t, calendar } = useLocale();
  if (calendar !== 'persian') {
    return <Input id={id} type="datetime-local" value={value} onChange={(event) => onChange(event.target.value)} {...aria} />;
  }
  const [date = '', time = ''] = value.split('T');
  const combine = (nextDate: string, nextTime: string) => onChange(nextDate === '' ? '' : `${nextDate}T${nextTime || '00:00'}`);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DateInput id={id} live value={date} label={label} onChange={(next) => combine(next, time)} className="min-w-44 flex-1" {...aria} />
      <Input type="time" dir="ltr" aria-label={t('date.time', { name: label })} className="w-28" value={time} onChange={(event) => combine(date, event.target.value)} />
    </div>
  );
}

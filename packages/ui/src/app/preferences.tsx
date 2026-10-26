import { useState } from 'react';
import { Languages, Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/i18n';
import { readTheme, saveTheme, type ThemeChoice } from '@/lib/theme';
import { cn } from '@/lib/utils';

const LANGUAGE_NAMES: Record<string, string> = { en: 'English', fa: 'فارسی' };

/** Light, dark or system, remembered in this browser. */
export function ThemeSwitch() {
  const { t } = useLocale();
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  const options: Array<[ThemeChoice, string, typeof Sun]> = [
    ['light', t('shell.themeLight'), Sun],
    ['dark', t('shell.themeDark'), Moon],
    ['system', t('shell.themeSystem'), Monitor],
  ];
  return (
    <div role="radiogroup" aria-label={t('shell.theme')} className="flex items-center rounded-control border border-border p-0.5">
      {options.map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={choice === value}
          aria-label={label}
          title={label}
          className={cn('rounded-md p-1.5 text-muted-foreground hover:text-foreground', choice === value && 'bg-muted text-foreground')}
          onClick={() => {
            saveTheme(value);
            setChoice(value);
          }}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}

/** Shown when the admin offers more than one language. */
export function LocaleSwitch() {
  const { t, locale, locales, setLocale } = useLocale();
  if (locales.length < 2) return null;
  return (
    <label className="flex items-center gap-1.5 text-[13px]">
      <Languages className="size-4 text-muted-foreground" aria-hidden />
      <span className="sr-only">{t('shell.language')}</span>
      <select
        className="h-8 flex-1 rounded-control border border-input bg-card px-2 text-[13px]"
        value={locale}
        onChange={(event) => setLocale(event.target.value)}
      >
        {locales.map((code) => (
          <option key={code} value={code} lang={code}>
            {LANGUAGE_NAMES[code] ?? code}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Calendar and digits: how dates and numbers are shown in this browser (inside the user menu). */
export function DisplayMenuItems() {
  const { t, calendar, digits, setDisplay } = useLocale();
  const group = <T extends string>(label: string, value: T, options: Array<[T, string]>, onPick: (value: T) => void) => (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex rounded-control border border-border p-0.5">
        {options.map(([option, text]) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            className={cn('flex-1 cursor-pointer rounded-md px-2 py-1 text-[13px] text-muted-foreground hover:text-foreground', value === option && 'bg-muted text-foreground')}
            onClick={() => onPick(option)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <>
      {group(t('display.calendar'), calendar, [['gregorian', t('display.gregorian')], ['persian', t('display.jalali')]], (value) => setDisplay({ calendar: value }))}
      {group(t('display.digits'), digits, [['latn', t('display.latinDigits')], ['arabext', t('display.persianDigits')]], (value) => setDisplay({ digits: value }))}
    </>
  );
}

/** The top bar's one-click theme button (the design's sun/moon): flips between light and dark. */
export function ThemeToggle() {
  const { t } = useLocale();
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  const dark = choice === 'dark' || (choice === 'system' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t('shell.theme')}
      title={t('shell.theme')}
      onClick={() => {
        const next = dark ? 'light' : 'dark';
        saveTheme(next);
        setChoice(next);
      }}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}

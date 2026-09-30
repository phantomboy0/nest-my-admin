import { useState } from 'react';
import { Languages, Monitor, Moon, Sun } from 'lucide-react';
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
    <div role="radiogroup" aria-label={t('shell.theme')} className="flex items-center rounded-lg border p-0.5">
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
    <label className="flex items-center gap-1.5 text-sm">
      <Languages className="size-4 text-muted-foreground" aria-hidden />
      <span className="sr-only">{t('shell.language')}</span>
      <select
        className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
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

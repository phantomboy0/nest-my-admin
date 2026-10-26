import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Languages, Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/i18n';
import { ACCENT_EVENT, THEME_EVENT, applyAccent, flipTheme, readAccent, readTheme, saveAccent, saveTheme, type ThemeChoice } from '@/lib/theme';
import { api, describeError } from '@/lib/api';
import { useSession } from '@/lib/queries';
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
  // The palette can flip the theme too.
  useEffect(() => {
    const follow = () => setChoice(readTheme());
    window.addEventListener(THEME_EVENT, follow);
    return () => window.removeEventListener(THEME_EVENT, follow);
  }, []);
  const dark = choice === 'dark' || (choice === 'system' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t('shell.theme')}
      title={t('shell.theme')}
      onClick={flipTheme}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}

/** The design's accents, offered as swatches; any other colour through the picker. */
const ACCENTS = ['#5B5BD6', '#2563EB', '#0E7490', '#0F766E', '#9333EA', '#DB2777', '#EA580C'];

/**
 * The accent colour: this person's own (kept in this browser), or «Default» to follow the admin's. With
 * `appearance.manage`, the colour shown can also be set (or reset) for everyone.
 */
export function AccentPicker() {
  const { t } = useLocale();
  const session = useSession();
  const queryClient = useQueryClient();
  const [personal, setPersonal] = useState<string | null>(readAccent);
  useEffect(() => {
    const follow = () => setPersonal(readAccent());
    window.addEventListener(ACCENT_EVENT, follow);
    return () => window.removeEventListener(ACCENT_EVENT, follow);
  }, []);
  const appearance = session.data?.appearance;
  const save = useMutation({
    mutationFn: (accent: string | null) => api.setAppearance(accent),
    onSuccess: async ({ accent }) => {
      // Everyone gets it; this person follows it too.
      saveAccent(null);
      applyAccent({ admin: accent });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });
  const pick = (color: string | null) => {
    saveAccent(color);
    applyAccent();
  };
  const shown = personal ?? appearance?.accent ?? null;
  return (
    <div role="group" aria-label={t('display.accent')} className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{t('display.accent')}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {ACCENTS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={color}
            aria-pressed={shown?.toLowerCase() === color.toLowerCase()}
            className={cn('size-6 cursor-pointer rounded-full border-2 border-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring', shown?.toLowerCase() === color.toLowerCase() && 'border-foreground')}
            style={{ background: color }}
            onClick={() => pick(color)}
          />
        ))}
        <label className="relative size-6 cursor-pointer overflow-hidden rounded-full border border-border" title={t('display.customAccent')}>
          <span className="sr-only">{t('display.customAccent')}</span>
          <input type="color" className="absolute inset-0 size-full cursor-pointer opacity-0" value={/^#[0-9a-f]{6}$/i.test(shown ?? '') ? shown! : '#5b5bd6'} onChange={(event) => pick(event.target.value)} />
          <span aria-hidden className="block size-full bg-[conic-gradient(red,yellow,lime,aqua,blue,magenta,red)]" />
        </label>
        <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs" aria-pressed={personal === null} onClick={() => pick(null)}>
          {t('display.defaultAccent')}
        </Button>
      </div>
      {appearance?.manage && (
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={save.isPending || !personal || personal === appearance.accent} onClick={() => save.mutate(personal)}>
            {t('display.accentForEveryone')}
          </Button>
          {appearance.accent && (
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" disabled={save.isPending} onClick={() => save.mutate(null)}>
              {t('display.resetForEveryone')}
            </Button>
          )}
        </div>
      )}
      {save.isError && <p className="text-xs text-destructive">{describeError(save.error)}</p>}
    </div>
  );
}

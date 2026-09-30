/** How dates and numbers are shown in this browser (values on the wire never change). */
export type CalendarChoice = 'gregorian' | 'persian';
export type DigitsChoice = 'latn' | 'arabext';

export interface DisplayPrefs {
  calendar: CalendarChoice;
  digits: DigitsChoice;
}

const CALENDAR_KEY = 'nma.calendar';
const DIGITS_KEY = 'nma.digits';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked: defaults
  }
}

/** The saved choices; without one, the Jalali calendar for Persian and Latin digits. */
export function readDisplayPrefs(locale: string): DisplayPrefs {
  const calendar = read(CALENDAR_KEY);
  const digits = read(DIGITS_KEY);
  return {
    calendar: calendar === 'gregorian' || calendar === 'persian' ? calendar : locale.split('-')[0] === 'fa' ? 'persian' : 'gregorian',
    digits: digits === 'latn' || digits === 'arabext' ? digits : 'latn',
  };
}

export function saveDisplayPrefs(prefs: Partial<DisplayPrefs>): void {
  try {
    if (prefs.calendar) localStorage.setItem(CALENDAR_KEY, prefs.calendar);
    if (prefs.digits) localStorage.setItem(DIGITS_KEY, prefs.digits);
  } catch {
    // not remembered
  }
}

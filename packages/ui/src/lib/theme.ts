import type { BrandingConfig } from '@nest-my-admin/core/contract';

export type ThemeChoice = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'nma.theme';
const DARK_TEXT = 'oklch(0.145 0 0)';
const LIGHT_TEXT = 'oklch(0.985 0 0)';

export function readTheme(): ThemeChoice {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    // storage blocked: follow the system
  }
  return 'system';
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): 'light' | 'dark' {
  return choice === 'system' ? (prefersDark ? 'dark' : 'light') : choice;
}

const prefersDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/** Sets the `dark` class (and color-scheme) for a choice; runs before React renders, so there is no flash. */
export function applyTheme(choice: ThemeChoice): void {
  const theme = resolveTheme(choice, prefersDark());
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // applied, not remembered
  }
  applyTheme(choice);
}

/** Follows the system setting while the choice is `system`. Returns the unsubscribe function. */
export function followSystemTheme(current: () => ThemeChoice): () => void {
  if (typeof matchMedia !== 'function') return () => undefined;
  const query = matchMedia('(prefers-color-scheme: dark)');
  const listener = () => {
    if (current() === 'system') applyTheme('system');
  };
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

/** Relative luminance of a hex or rgb() colour, or undefined for other notations. */
export function luminance(color: string): number | undefined {
  let rgb: number[] | undefined;
  const hex = /^#([0-9a-f]{3,8})$/i.exec(color.trim())?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex.slice(0, 3)].map((digit) => digit + digit).join('') : hex.slice(0, 6);
    rgb = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16));
  } else {
    const parts = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(color.trim());
    if (parts) rgb = parts.slice(1, 4).map(Number);
  }
  if (!rgb) return undefined;
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * CSS variables for the host's branding. Text on the primary colour is dark or light from its luminance when it can be
 * computed (hex, rgb), else light, unless `primaryForeground` says otherwise. Core validated every value.
 */
export function brandingVariables(branding: BrandingConfig): Record<string, string> {
  const vars: Record<string, string> = {};
  if (branding.primaryColor) {
    const lum = luminance(branding.primaryColor);
    const text = branding.primaryForeground ?? (lum !== undefined && lum > 0.45 ? DARK_TEXT : LIGHT_TEXT);
    Object.assign(vars, {
      '--primary': branding.primaryColor,
      '--primary-foreground': text,
      '--ring': branding.primaryColor,
      '--sidebar-primary': branding.primaryColor,
      '--sidebar-primary-foreground': text,
    });
  }
  if (branding.radius) vars['--radius'] = branding.radius;
  return vars;
}

/** Inline custom properties on <html> beat the theme's, in light and dark alike, and need no <style> (CSP-safe). */
export function applyBranding(branding: BrandingConfig): void {
  for (const [name, value] of Object.entries(brandingVariables(branding))) document.documentElement.style.setProperty(name, value);
}

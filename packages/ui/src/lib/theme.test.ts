import { describe, expect, test } from 'bun:test';
import { brandingVariables, effectiveAccent, luminance, resolveTheme } from './theme';

describe('theme', () => {
  test('system follows the preference; explicit choices win', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });
});

describe('branding', () => {
  test('luminance of hex and rgb colours', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1);
    expect(luminance('#000')).toBeCloseTo(0);
    expect(luminance('rgb(15, 118, 110)')).toBeCloseTo(luminance('#0f766e')!);
    expect(luminance('oklch(0.6 0.1 180)')).toBeUndefined();
  });

  test('primary colour, readable text on it, and radius', () => {
    expect(brandingVariables({ primaryColor: '#0f766e', radius: '0.25rem' })).toEqual({
      '--primary': '#0f766e',
      '--primary-foreground': 'oklch(0.985 0 0)',
      '--ring': '#0f766e',
      '--sidebar-primary': '#0f766e',
      '--sidebar-primary-foreground': 'oklch(0.985 0 0)',
      '--nma-radius-control': '0.25rem',
      '--nma-radius-card': 'calc(0.25rem * 1.5)',
    });
    expect(brandingVariables({ primaryColor: '#fde047' })['--primary-foreground']).toBe('oklch(0.145 0 0)');
    expect(brandingVariables({ primaryColor: 'oklch(0.9 0.1 90)', primaryForeground: '#111' })['--primary-foreground']).toBe('#111');
    expect(brandingVariables({})).toEqual({});
  });

  test('the radius scales controls and cards together (8px : 12px by default)', () => {
    expect(brandingVariables({ radius: '6px' })).toEqual({ '--nma-radius-control': '6px', '--nma-radius-card': 'calc(6px * 1.5)' });
  });
});

describe('accent', () => {
  test('your own pick wins, then the admin’s, then the host’s branding, then the default', () => {
    expect(effectiveAccent({ personal: '#9333EA', admin: '#0E7490', branding: '#0f766e' })).toBe('#9333EA');
    expect(effectiveAccent({ personal: null, admin: '#0E7490', branding: '#0f766e' })).toBe('#0E7490');
    expect(effectiveAccent({ personal: null, admin: null, branding: '#0f766e' })).toBe('#0f766e');
    expect(effectiveAccent({ personal: null, admin: null })).toBeUndefined();
  });
  test('a personal pick that is not a plain colour is ignored', () => {
    expect(effectiveAccent({ personal: 'red; background: url(x)', admin: '#0E7490' })).toBe('#0E7490');
  });
});

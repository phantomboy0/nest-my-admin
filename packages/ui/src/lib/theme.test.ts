import { describe, expect, test } from 'bun:test';
import { brandingVariables, luminance, resolveTheme } from './theme';

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
      '--radius': '0.25rem',
    });
    expect(brandingVariables({ primaryColor: '#fde047' })['--primary-foreground']).toBe('oklch(0.145 0 0)');
    expect(brandingVariables({ primaryColor: 'oklch(0.9 0.1 90)', primaryForeground: '#111' })['--primary-foreground']).toBe('#111');
    expect(brandingVariables({})).toEqual({});
  });
});

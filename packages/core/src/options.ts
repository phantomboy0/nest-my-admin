import type { AdminError } from './errors.js';
import type { LocalizedText } from './i18n/localized-text.js';

/** Host branding for the UI (spec §9.5): applied as CSS variables and shown in the sidebar. */
export interface AdminBranding {
  /** Shown at the top of the sidebar; defaults to `title`. */
  name?: LocalizedText;
  /** Logo image URL (absolute http(s), or relative to the admin). */
  logo?: string;
  /** A CSS colour for buttons and highlights: hex, rgb(), hsl() or oklch(). */
  primaryColor?: string;
  /** Text colour on `primaryColor`; chosen from its lightness when omitted (hex and rgb). */
  primaryForeground?: string;
  /** Corner radius, a CSS length such as `0.5rem`. */
  radius?: string;
}

/**
 * Translates your own exceptions into admin errors. Return undefined to leave an error alone.
 * Runs for every error that is not already an AdminError, after the request's context has ended
 * (AdminContext.current() is undefined); use the error itself. It runs before the built-in database-error
 * mapping, so it sees raw driver errors: never put a raw error message (it may contain SQL) into a mapped
 * response. Errors from host middleware that carry a 4xx `status` and body-parser errors skip it.
 * A mapped error with status >= 500 is logged with the original stack and the correlation id.
 */
export type ErrorMapper = (error: unknown) => AdminError | undefined;

export interface AdminModuleOptions {
  /** Mount path of the admin UI and API. Default `/admin`. */
  path?: string;
  /** Title shown in the UI, in one or several languages. Default `Admin`. */
  title?: LocalizedText;
  /** Default UI language. Default `en`. */
  locale?: string;
  /** Languages people can switch between (the UI ships `en` and `fa`). Default `[locale]`. */
  locales?: string[];
  branding?: AdminBranding;
  /**
   * Give every entity without an @AdminResource a default resource: `true` for the default DataSource, or the names
   * of the DataSources to cover (`['default', 'reports']`). Default `false`.
   */
  autoRegister?: boolean | string[];
  /** Run every create/update/delete in one database transaction (ctx.manager). Default `true`. */
  transactions?: boolean;
  /** Translate your own exceptions into admin errors (see ErrorMapper). Default: none. */
  errorMapper?: ErrorMapper;
  /** Advanced: serve the UI from this directory instead of @nest-my-admin/ui (tests, UI development). */
  uiDistPath?: string;
}

export interface ResolvedAdminOptions {
  path: string;
  title: LocalizedText;
  locale: string;
  locales: string[];
  branding: AdminBranding;
  /** DataSource names whose entities get default resources. */
  autoRegister: string[];
  transactions: boolean;
  errorMapper?: ErrorMapper;
  uiDistPath?: string;
}

export function resolveAdminOptions(options: AdminModuleOptions = {}): ResolvedAdminOptions {
  const raw = (options.path ?? '/admin').trim();
  const path = '/' + raw.replace(/^\/+|\/+$/g, '');
  if (path === '/') {
    throw new Error('nest-my-admin: `path` must not be "/"; mount the admin under its own path such as "/admin"');
  }
  if (!/^\/[A-Za-z0-9\-._~/]+$/.test(path)) throw new Error(`nest-my-admin: invalid path "${options.path}"`);
  const locale = options.locale ?? 'en';
  const locales = options.locales ?? [locale];
  if (!locales.includes(locale)) throw new Error(`nest-my-admin: locale "${locale}" must be one of locales (${locales.join(', ')})`);
  return {
    path,
    title: options.title ?? 'Admin',
    locale,
    locales,
    branding: checkBranding(options.branding ?? {}),
    uiDistPath: options.uiDistPath,
    autoRegister: options.autoRegister === true ? ['default'] : Array.isArray(options.autoRegister) ? options.autoRegister : [],
    transactions: options.transactions ?? true,
    errorMapper: options.errorMapper,
  };
}

const CSS_COLOR = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab|lch|lab)\([0-9.,%\s/+-]+(deg|turn|rad)?[0-9.,%\s/+-]*\))$/i;
const CSS_LENGTH = /^(0|\d+(\.\d+)?(px|rem|em))$/;

/** Branding ends up in CSS and an <img>: only plain colours, lengths and http(s) or relative URLs get through. */
function checkBranding(branding: AdminBranding): AdminBranding {
  for (const key of ['primaryColor', 'primaryForeground'] as const) {
    const value = branding[key];
    if (value !== undefined && !CSS_COLOR.test(value.trim())) throw new Error(`nest-my-admin: branding.${key} must be a CSS colour (hex, rgb(), hsl() or oklch()), got "${value}"`);
  }
  if (branding.radius !== undefined && !CSS_LENGTH.test(branding.radius.trim())) {
    throw new Error(`nest-my-admin: branding.radius must be a length such as 0.5rem, got "${branding.radius}"`);
  }
  // http(s), or no scheme at all (a relative path): never javascript:, data: and the like
  if (branding.logo !== undefined && !/^https?:\/\//i.test(branding.logo) && /^[a-z][a-z0-9+.-]*:/i.test(branding.logo.trim())) {
    throw new Error('nest-my-admin: branding.logo must be an http(s) URL or a relative path');
  }
  return branding;
}

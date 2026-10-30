import type { EntityMetadata } from 'typeorm';
import type { AdminAuthConfig, AdminUser } from './auth/auth-adapter.js';
import type { ScopeCondition } from './decorators/admin-scope.js';
import type { RoleDefinition } from './policy/roles.js';
import type { AdminContext } from './resource/admin-context.js';
import type { AdminError } from './errors.js';
import type { LocalizedText } from './i18n/localized-text.js';
import { createTexts, type AdminTranslate, type TextResolver } from './i18n/texts.js';
import { Logger } from '@nestjs/common';
import type { AdminStorage } from './files/storage.js';
import { checkCurrency, type AdminCurrency } from './schema/currency.js';
import { DEFAULT_MAX_FILE_BYTES, MAX_FILE_BYTES } from './schema/field-config.js';

export type { AdminCurrency } from './schema/currency.js';

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
 * One menu entry: a resource (with an optional count badge: `filter[...]` list parameters), a settings page, or a link.
 * A resource or page is named, or given as its class (`{ resource: OrderAdmin }`, `{ page: ShopSettingsPage }`).
 */
export type AdminMenuItem =
  | { resource: string | Function; badge?: Record<string, string> }
  | { page: string | Function }
  | { href: string; label: LocalizedText };

/** A section of the menu: its own label, icon and items, or an `@AdminGroup`'s (`{ group: 'sales' }`). */
export type AdminMenuSection =
  | {
      /** Unique; also the URL of the section's page (`/g/<key>`) and the badge key prefix. */
      key: string;
      label: LocalizedText;
      icon: string;
      items: AdminMenuItem[];
      group?: undefined;
    }
  | {
      /** The group's key: label, icon and (without `items`) the members come from the group; what you give wins. */
      group: string;
      /** Default: the group's key. */
      key?: string;
      label?: LocalizedText;
      icon?: string;
      /** Default: the group's resources and settings pages, in the group's order. */
      items?: AdminMenuItem[];
    };

export interface AdminMenuOptions {
  sections: AdminMenuSection[];
  /** The last section holding everything not placed. Default label «Advanced». */
  advanced?: { label?: LocalizedText };
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

/**
 * A scope ANDed onto every resource it applies to (spec §6.4), typically the tenant:
 * `{ name: 'tenant', appliesTo: ({ metadata }) => metadata.findColumnWithPropertyName('tenantId') !== undefined,
 *    where: (ctx) => ({ tenantId: ctx.user?.attrs?.tenantId }) }`.
 */
export interface GlobalScope {
  name: string;
  /** Default: every resource. */
  appliesTo?: (resource: { name: string; entity: Function; metadata: EntityMetadata }) => boolean;
  where: (ctx: AdminContext, resource: { name: string }) => ScopeCondition;
  /** Superusers are restricted too, unless this is true. */
  exemptSuperusers?: boolean;
}

/** File and image fields, uploads and downloads (spec §8.2). */
export interface AdminFilesOptions {
  /** Where files are kept: `localStorage({ dir })`, `s3Storage({ ... })` or your own AdminStorage. */
  storage: AdminStorage;
  /** Largest upload in bytes unless a field says otherwise. Default 10 MiB. */
  maxBytes?: number;
  /** Replaces the built-in HTML sanitizer of rich-text fields. */
  sanitizeHtml?: (html: string) => string;
  /** The TypeORM DataSource holding `ADMIN_FILE_ENTITIES` (default: the default DataSource). */
  dataSource?: string;
}

/** The audit log (spec §10.2): every change made through the admin, sign-ins and permission changes. */
export interface AdminAuditOptions {
  /** Entries older than this many days are deleted. Default: kept for ever. */
  retentionDays?: number;
  /** The TypeORM DataSource holding `ADMIN_AUDIT_ENTITIES` (default: the default DataSource). */
  dataSource?: string;
}

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
   * The sidebar in the owner's words (spec §5.3): ordered sections listing resources, settings pages and links.
   * Whatever is visible and not placed goes into a last «advanced» section, collapsed. Without it, Nest modules group
   * the sidebar as before.
   */
  menu?: AdminMenuOptions;
  /**
   * Let the admin's look be changed in the admin: an accent colour for everyone, set by users with
   * `appearance.manage` (each person may still pick their own). Stored in `nma_setting`: add `ADMIN_SETTING_ENTITIES`
   * to the DataSource (`dataSource`, default the default one).
   */
  appearance?: { dataSource?: string };
  /** The unit shown with every `money` field that sets none of its own. Display only: values are never converted. */
  currency?: AdminCurrency;
  /**
   * Give every entity without an @AdminResource a default resource: `true` for the default DataSource, or the names
   * of the DataSources to cover (`['default', 'reports']`). Default `false`.
   */
  autoRegister?: boolean | string[];
  /** Run every create/update/delete in one database transaction (ctx.manager). Default `true`. */
  transactions?: boolean;
  /** Translate your own exceptions into admin errors (see ErrorMapper). Default: none. */
  errorMapper?: ErrorMapper;
  /**
   * Resolves every text you declare (labels, help, enum labels, sections…) and the UI's own texts (`ui.<key>`) per
   * locale, with your own i18n. Answer undefined to keep the declared text. See AdminTranslate for the keys.
   */
  translate?: AdminTranslate;
  /** Advanced: serve the UI from this directory instead of @nest-my-admin/ui (tests, UI development). */
  uiDistPath?: string;
  /**
   * Who may use the admin: `builtinAuth()` from @nest-my-admin/auth, `AdminAuth.custom(YourAdapter)`, or
   * `AdminAuth.none()`. Without it the admin is open (a warning at boot) and, with NODE_ENV=production, does not boot.
   */
  auth?: AdminAuthConfig;
  /** Roles defined in code (spec §6.1): permissions, field rules and row scopes. */
  roles?: RoleDefinition[];
  /** Role names of a signed-in user (with the auth adapter's own `resolveRoles`, if any; the union counts). */
  resolveRoles?: (user: AdminUser) => string[] | Promise<string[]>;
  /** Scopes ANDed onto every resource they apply to (multi-tenancy). */
  globalScopes?: GlobalScope[];
  /** Global custom permission codes (`reports.run`) for roles and `ctx.can()`. */
  permissions?: string[];
  /**
   * Roles, groups and memberships stored in the database and managed in the admin (Users, Groups, Roles pages).
   * Add `ADMIN_RBAC_ENTITIES` to the TypeORM entities of `dataSource` (default: the default DataSource).
   */
  rbac?: { dataSource?: string };
  /**
   * Uploads to file and image fields. Add `ADMIN_FILE_ENTITIES` to the TypeORM entities of `dataSource`.
   * Without it `/api/uploads` answers 404.
   */
  files?: AdminFilesOptions;
  /**
   * Records who changed what and when (records, actions, settings pages, roles and groups, sign-ins). Add
   * `ADMIN_AUDIT_ENTITIES` to the TypeORM entities of `dataSource`. An entry is written in the transaction of the
   * change it describes when both are on the same DataSource; on another one it is written right after the commit.
   * Without it nothing is recorded.
   */
  audit?: AdminAuditOptions;
}

export interface ResolvedAdminOptions {
  path: string;
  title: LocalizedText;
  locale: string;
  locales: string[];
  branding: AdminBranding;
  menu?: AdminMenuOptions;
  appearance?: { dataSource?: string };
  currency?: Required<AdminCurrency>;
  /** DataSource names whose entities get default resources. */
  autoRegister: string[];
  transactions: boolean;
  errorMapper?: ErrorMapper;
  translate?: AdminTranslate;
  /** Every host text goes through this: `translate`, else the declared text. */
  texts: TextResolver;
  uiDistPath?: string;
  auth?: AdminAuthConfig;
  roles: RoleDefinition[];
  resolveRoles?: (user: AdminUser) => string[] | Promise<string[]>;
  globalScopes: GlobalScope[];
  permissions: string[];
  rbac?: { dataSource?: string };
  files?: AdminFilesOptions & { maxBytes: number };
  audit?: AdminAuditOptions;
}

export function resolveAdminOptions(options: AdminModuleOptions = {}): ResolvedAdminOptions {
  const raw = (options.path ?? '/admin').trim();
  const path = '/' + raw.replace(/^\/+|\/+$/g, '');
  if (path === '/') {
    throw new Error('nest-my-admin: `path` must not be "/"; mount the admin under its own path such as "/admin"');
  }
  if (!/^\/[A-Za-z0-9\-._~/]+$/.test(path)) throw new Error(`nest-my-admin: invalid path "${options.path}"`);
  if (!options.auth && process.env.NODE_ENV === 'production') {
    throw new Error(
      'nest-my-admin: no `auth` configured with NODE_ENV=production: the admin would be open to anyone. ' +
        'Use auth: builtinAuth() (from @nest-my-admin/auth), AdminAuth.custom(YourAdapter), or AdminAuth.none() if that is really intended.',
    );
  }
  const locale = options.locale ?? 'en';
  const locales = options.locales ?? [locale];
  if (!locales.includes(locale)) throw new Error(`nest-my-admin: locale "${locale}" must be one of locales (${locales.join(', ')})`);
  return {
    path,
    title: options.title ?? 'Admin',
    locale,
    locales,
    branding: checkBranding(options.branding ?? {}),
    currency: options.currency && checkCurrency(options.currency, 'currency'),
    menu: options.menu && checkMenuShape(options.menu),
    appearance: options.appearance,
    uiDistPath: options.uiDistPath,
    autoRegister: options.autoRegister === true ? ['default'] : Array.isArray(options.autoRegister) ? options.autoRegister : [],
    transactions: options.transactions ?? true,
    errorMapper: options.errorMapper,
    translate: options.translate,
    texts: createTexts({ translate: options.translate, locale }, new Logger('NestMyAdmin')),
    auth: options.auth,
    roles: options.roles ?? [],
    resolveRoles: options.resolveRoles,
    globalScopes: options.globalScopes ?? [],
    permissions: options.permissions ?? [],
    rbac: options.rbac,
    files: checkFiles(options.files),
    audit: checkAudit(options.audit),
  };
}

/** A plain CSS colour (hex, rgb(), hsl(), oklch()…): what may reach a style property. */
export function isCssColor(value: string): boolean {
  return CSS_COLOR.test(value.trim());
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

/** What can be checked before the resources exist: keys, items and links (references are checked at bootstrap). */
function checkMenuShape(menu: AdminMenuOptions): AdminMenuOptions {
  if (!Array.isArray(menu.sections)) throw new Error('nest-my-admin: menu.sections must be a list');
  const keys = new Set<string>();
  for (const section of menu.sections) {
    if (section.group !== undefined && (typeof section.group !== 'string' || section.group === '')) throw new Error('nest-my-admin: menu section `group` must be a group key');
  }
  // A group section is keyed by its group unless it says otherwise.
  const sections = menu.sections.map((section) => (section.group !== undefined && section.key === undefined ? { ...section, key: section.group } : section));
  for (const section of sections) {
    const where = `nest-my-admin: menu.sections.${String(section.key)}`;
    if (typeof section.key !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(section.key)) throw new Error(`nest-my-admin: menu section key "${String(section.key)}" must be letters, digits, - and _`);
    if (section.key === 'advanced') throw new Error(`${where}: the key "advanced" is the last section's`);
    if (keys.has(section.key)) throw new Error(`${where}: the key is used twice`);
    keys.add(section.key);
    if (section.group === undefined && !Array.isArray(section.items)) throw new Error(`${where}: items must be a list`);
    if (section.items !== undefined && !Array.isArray(section.items)) throw new Error(`${where}: items must be a list`);
    for (const item of section.items ?? []) {
      if ('href' in item && /^[a-z][a-z0-9+.-]*:/i.test(item.href.trim()) && !/^https?:\/\//i.test(item.href.trim())) throw new Error(`${where}: href must be an http(s) URL or a relative path`);
    }
  }
  return { ...menu, sections };
}

function checkFiles(files: AdminFilesOptions | undefined): ResolvedAdminOptions['files'] {
  if (!files) return undefined;
  const storage = files.storage as Partial<AdminStorage> | undefined;
  if (!storage || (['put', 'get', 'delete', 'publicUrl'] as const).some((method) => typeof storage[method] !== 'function')) {
    throw new Error('nest-my-admin: files.storage must be an AdminStorage (localStorage({ dir }), s3Storage({ ... }) or your own)');
  }
  const maxBytes = files.maxBytes ?? DEFAULT_MAX_FILE_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('nest-my-admin: files.maxBytes must be a positive number of bytes');
  if (maxBytes > MAX_FILE_BYTES) throw new Error(`nest-my-admin: files.maxBytes must be at most ${MAX_FILE_BYTES} bytes (2 GiB - 1)`);
  if (files.sanitizeHtml !== undefined && typeof files.sanitizeHtml !== 'function') throw new Error('nest-my-admin: files.sanitizeHtml must be a function');
  return { ...files, maxBytes };
}

function checkAudit(audit: AdminAuditOptions | undefined): AdminAuditOptions | undefined {
  if (!audit) return undefined;
  const days = audit.retentionDays;
  if (days !== undefined && (!Number.isSafeInteger(days) || days <= 0)) throw new Error('nest-my-admin: audit.retentionDays must be a positive whole number of days');
  return audit;
}

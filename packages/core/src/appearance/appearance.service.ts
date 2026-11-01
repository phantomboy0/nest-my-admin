import { createHash } from 'node:crypto';
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ADMIN_OPTIONS } from '../constants.js';
import { AdminForbiddenError, AdminNotFoundError, AdminValidationError } from '../errors.js';
import { isCssColor, type ResolvedAdminOptions } from '../options.js';
import { AdminPolicy } from '../policy/admin-policy.service.js';
import type { AdminContext } from '../resource/admin-context.js';
import { ADMIN_SETTING_ENTITIES, NmaSetting } from './entities.js';

/** Changing the admin-wide look. A code only while `appearance` is on. */
export const APPEARANCE_CODES = ['appearance.manage'];
const ACCENT = 'appearance.accent';

/** The pictures the admin's look has: the logo (sidebar and sign-in page) and the browser tab's icon. */
export const APPEARANCE_IMAGES = ['logo', 'favicon'] as const;
export type AppearanceImageKind = (typeof APPEARANCE_IMAGES)[number];
/** The most an uploaded logo or favicon may weigh. */
export const MAX_APPEARANCE_IMAGE_BYTES = 512 * 1024;

/** The image types accepted, each with a check of the bytes (so a file is what its type says). */
const IMAGE_TYPES: Record<string, (data: Buffer) => boolean> = {
  'image/png': (d) => d.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (d) => d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff,
  'image/gif': (d) => d.subarray(0, 4).toString('latin1') === 'GIF8',
  'image/webp': (d) => d.subarray(0, 4).toString('latin1') === 'RIFF' && d.subarray(8, 12).toString('latin1') === 'WEBP',
  'image/x-icon': (d) => d.readUInt32BE(0) === 0x00000100,
  'image/vnd.microsoft.icon': (d) => d.readUInt32BE(0) === 0x00000100,
  'image/svg+xml': (d) => /<svg[\s>]/i.test(d.subarray(0, 4096).toString('utf8')),
};
/** The media type of an upload (`image/png; charset=…` → `image/png`), or undefined when it is not an accepted image. */
export function appearanceImageType(contentType: string | undefined): string | undefined {
  const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  return type in IMAGE_TYPES ? type : undefined;
}

interface StoredImage {
  type: string;
  data: Buffer;
  /** The first 12 hex digits of its SHA-256: the `?v=` of its URL, so a new picture is never served from a cache. */
  version: string;
}

/**
 * The admin-wide accent colour (`forRoot({ appearance })`): set in the admin by whoever holds `appearance.manage`, seen
 * by everyone (it wins over `branding.primaryColor`; each person may still pick their own in their browser).
 */
@Injectable()
export class AdminAppearance implements OnApplicationBootstrap {
  private dataSource?: DataSource;
  /** The stored accent, read once at boot and kept current by `setAccent`. */
  private accent: string | null = null;
  /** The uploaded pictures, read once at boot and kept current by `setImage`. */
  private readonly images = new Map<AppearanceImageKind, StoredImage>();

  constructor(
    @Inject(ADMIN_OPTIONS) private readonly options: ResolvedAdminOptions,
    private readonly moduleRef: ModuleRef,
    private readonly policy: AdminPolicy,
  ) {}

  get enabled(): boolean {
    return this.options.appearance !== undefined;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.options.appearance) return;
    const name = this.options.appearance.dataSource;
    try {
      this.dataSource = this.moduleRef.get<DataSource>(getDataSourceToken(name) as string, { strict: false });
    } catch {
      throw new Error(`nest-my-admin: appearance: no TypeORM DataSource "${name ?? 'default'}"`);
    }
    for (const entity of ADMIN_SETTING_ENTITIES) {
      if (!this.dataSource.hasMetadata(entity)) throw new Error(`nest-my-admin: appearance: add ADMIN_SETTING_ENTITIES to the entities of the DataSource "${name ?? 'default'}"`);
    }
    const stored = await this.dataSource.getRepository(NmaSetting).findOneBy({ key: ACCENT });
    this.accent = typeof stored?.value === 'string' && isCssColor(stored.value) ? stored.value : null;
    for (const kind of APPEARANCE_IMAGES) {
      const row = await this.dataSource.getRepository(NmaSetting).findOneBy({ key: `appearance.${kind}` });
      const value = row?.value as { type?: unknown; data?: unknown } | undefined;
      if (typeof value?.type !== 'string' || typeof value.data !== 'string' || !(value.type in IMAGE_TYPES)) continue;
      const data = Buffer.from(value.data, 'base64');
      this.images.set(kind, { type: value.type, data, version: versionOf(data) });
    }
  }

  /** An uploaded picture (served at `<path>/appearance/<kind>`), or undefined. */
  image(kind: string): StoredImage | undefined {
    return (APPEARANCE_IMAGES as readonly string[]).includes(kind) ? this.images.get(kind as AppearanceImageKind) : undefined;
  }

  /** Where the page finds each uploaded picture, relative to the admin's `<base href>`; null when there is none. */
  imageUrls(): { logo: string | null; favicon: string | null } {
    const url = (kind: AppearanceImageKind) => {
      const image = this.images.get(kind);
      return image ? `appearance/${kind}?v=${image.version}` : null;
    };
    return { logo: url('logo'), favicon: url('favicon') };
  }

  /** `PUT /api/appearance/:kind` (a picture) and `DELETE` (`null`: none again, so `branding.logo` is back). */
  async setImage(kind: string, type: string | undefined, data: Buffer | null, ctx: AdminContext): Promise<{ logo: string | null; favicon: string | null }> {
    if (!this.dataSource) throw new AdminNotFoundError('The look is not set in this admin (no `appearance` option)');
    if (!(APPEARANCE_IMAGES as readonly string[]).includes(kind)) throw new AdminNotFoundError(`No admin picture "${kind}" (logo or favicon)`);
    if (ctx.viewAs || !this.policy.permissionsOf(ctx).can('appearance.manage')) throw new AdminForbiddenError('You may not change the admin’s look');
    const repo = this.dataSource.getRepository(NmaSetting);
    if (data === null) {
      await repo.delete({ key: `appearance.${kind}` });
      this.images.delete(kind as AppearanceImageKind);
      return this.imageUrls();
    }
    if (!type || !IMAGE_TYPES[type]!(data)) throw new AdminValidationError({ [kind]: [`the file is not a ${type ?? 'picture'}`] });
    await repo.save({ key: `appearance.${kind}`, value: { type, data: data.toString('base64') } });
    this.images.set(kind as AppearanceImageKind, { type, data, version: versionOf(data) });
    return this.imageUrls();
  }

  /** The admin-wide accent (`SessionResponse.appearance.accent`). */
  current(): string | null {
    return this.accent;
  }

  /** `PUT /api/appearance`: a CSS colour, or `null` for the host's branding again. */
  async setAccent(accent: unknown, ctx: AdminContext): Promise<{ accent: string | null }> {
    if (!this.dataSource) throw new AdminNotFoundError('The look is not set in this admin (no `appearance` option)');
    if (ctx.viewAs || !this.policy.permissionsOf(ctx).can('appearance.manage')) throw new AdminForbiddenError('You may not change the admin’s look');
    if (accent !== null && (typeof accent !== 'string' || !isCssColor(accent))) throw new AdminValidationError({ accent: ['must be a CSS colour (hex, rgb(), hsl() or oklch()) or null'] });
    const value = accent === null ? null : accent.trim();
    if (value === null) await this.dataSource.getRepository(NmaSetting).delete({ key: ACCENT });
    else await this.dataSource.getRepository(NmaSetting).save({ key: ACCENT, value });
    this.accent = value;
    return { accent: value };
  }
}

const versionOf = (data: Buffer) => createHash('sha256').update(data).digest('hex').slice(0, 12);

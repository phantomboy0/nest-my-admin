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

/**
 * The admin-wide accent colour (`forRoot({ appearance })`): set in the admin by whoever holds `appearance.manage`, seen
 * by everyone (it wins over `branding.primaryColor`; each person may still pick their own in their browser).
 */
@Injectable()
export class AdminAppearance implements OnApplicationBootstrap {
  private dataSource?: DataSource;
  /** The stored accent, read once at boot and kept current by `setAccent`. */
  private accent: string | null = null;

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

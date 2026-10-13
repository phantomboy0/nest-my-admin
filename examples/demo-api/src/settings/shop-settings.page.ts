import { AdminFieldError, AdminSettingsPage, type AdminContext, type AdminFile, type AdminSettingsSource } from '@nest-my-admin/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { DataSource } from 'typeorm';
import { ShopSetting } from './shop-setting.entity.js';

export class ShopSettingsDto {
  @IsString() @Length(2, 60) shopName: string;
  @IsOptional() @IsEmail() supportEmail?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(1000) lowStockThreshold?: number | null;
  @IsOptional() @IsBoolean() maintenance?: boolean;
  /** A file field: `save()` gets an `AdminFile` (or null) and stores its key. */
  @IsOptional() logo?: AdminFile | string | null;
  /** Write-only: the admin never serves it, only whether one is set. */
  @IsOptional() @IsString() @Length(12, 80) paymentApiKey?: string | null;
}

/**
 * The shop's settings: one form, stored as JSON rows in `shop_setting`. Viewing needs `page.shop`, saving
 * `page.shop.update`.
 *
 * The payment key is a secret. This demo keeps it as it is in the table; a real shop encrypts it (or hands it to a
 * secrets manager) in `save()` and decrypts it where it is used.
 */
@AdminSettingsPage('shop', {
  label: { en: 'Shop settings', fa: 'تنظیمات فروشگاه' },
  icon: 'store',
  group: 'settings',
  order: 10, // before any page added to the group later (the default is 100)
  form: ShopSettingsDto,
  fields: {
    shopName: { label: { en: 'Shop name', fa: 'نام فروشگاه' } },
    supportEmail: { label: { en: 'Support email', fa: 'ایمیل پشتیبانی' }, widget: 'email' },
    lowStockThreshold: {
      label: { en: 'Low stock threshold', fa: 'آستانه‌ی کمبود موجودی' },
      help: { en: 'Products with fewer items are reported as low.', fa: 'محصولاتی با موجودی کمتر، کم‌موجود گزارش می‌شوند.' },
    },
    maintenance: { label: { en: 'Maintenance mode', fa: 'حالت تعمیرات' }, widget: 'switch' },
    logo: { label: { en: 'Logo', fa: 'نشان' }, widget: 'image', file: { visibility: 'public', maxBytes: 1024 * 1024 } },
    paymentApiKey: {
      label: { en: 'Payment API key', fa: 'کلید API پرداخت' },
      secret: true,
      help: { en: 'Starts with sk_. It is never shown again after saving.', fa: 'با sk_ شروع می‌شود. پس از ذخیره دیگر نمایش داده نمی‌شود.' },
    },
  },
  layout: [
    { section: { en: 'Shop', fa: 'فروشگاه' }, fields: ['shopName', 'supportEmail', 'logo'], columns: 2 },
    { section: { en: 'Operations', fa: 'عملیات' }, fields: ['lowStockThreshold', 'maintenance'], columns: 2 },
    { section: { en: 'Payments', fa: 'پرداخت' }, fields: ['paymentApiKey'] },
  ],
})
export class ShopSettingsPage implements AdminSettingsSource<ShopSettingsDto> {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Inside a save the admin's transaction (`ctx.manager`), so `load()` sees what `save()` just wrote. */
  private rows(ctx: AdminContext) {
    return (ctx.manager ?? this.dataSource.manager).getRepository(ShopSetting);
  }

  /** Every stored value, the secret included: the admin keeps it to itself. A cleared logo is stored, and returned, as null. */
  async load(ctx: AdminContext): Promise<Partial<ShopSettingsDto>> {
    const rows = await this.rows(ctx).find();
    return Object.fromEntries(rows.map((row) => [row.name, JSON.parse(row.value)]));
  }

  /** Gets only the keys that were sent. */
  async save(changes: Partial<ShopSettingsDto>, ctx: AdminContext): Promise<void> {
    // Say what is wrong without repeating the key: an error message is no place for a secret.
    if (typeof changes.paymentApiKey === 'string' && !changes.paymentApiKey.startsWith('sk_')) {
      throw new AdminFieldError({ paymentApiKey: 'must start with sk_' });
    }
    for (const [name, value] of Object.entries(changes)) {
      const stored = name === 'logo' && value !== null ? (value as AdminFile).key : value;
      await this.rows(ctx).save({ name, value: JSON.stringify(stored ?? null) });
    }
  }
}

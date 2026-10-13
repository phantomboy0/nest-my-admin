import { AdminGroup } from '@nest-my-admin/core';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShopSetting } from './shop-setting.entity.js';
import { ShopSettingsPage } from './shop-settings.page.js';

/**
 * A group that holds only a settings page. The page joins it by key (`group: 'settings'`), as a page of any other
 * module could; the label and icon of the key's group come from this module's `@AdminGroup`.
 */
@AdminGroup({ key: 'settings', label: { en: 'Settings', fa: 'تنظیمات' }, icon: 'settings' })
@Module({ imports: [TypeOrmModule.forFeature([ShopSetting])], providers: [ShopSettingsPage] })
export class SettingsModule {}

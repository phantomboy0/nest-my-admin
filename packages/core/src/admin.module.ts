import { Module, type DynamicModule } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ADMIN_OPTIONS } from './constants.js';
import { resolveAdminOptions, type AdminModuleOptions } from './options.js';
import { ResourceRegistry } from './registry/resource-registry.js';

@Module({})
export class AdminModule {
  static forRoot(options: AdminModuleOptions = {}): DynamicModule {
    return {
      module: AdminModule,
      global: true,
      imports: [DiscoveryModule],
      providers: [{ provide: ADMIN_OPTIONS, useValue: resolveAdminOptions(options) }, ResourceRegistry],
      exports: [ResourceRegistry],
    };
  }
}

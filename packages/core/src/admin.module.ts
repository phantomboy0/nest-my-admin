import { Module, type DynamicModule } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AdminApiService } from './api/admin-api.service.js';
import { ADMIN_OPTIONS } from './constants.js';
import { AdminAuthService } from './auth/auth.service.js';
import { AdminHttpServer } from './http/admin-http.server.js';
import { resolveAdminOptions, type AdminModuleOptions } from './options.js';
import { ResourceRegistry } from './registry/resource-registry.js';

@Module({})
export class AdminModule {
  static forRoot(options: AdminModuleOptions = {}): DynamicModule {
    return {
      module: AdminModule,
      global: true,
      imports: [DiscoveryModule],
      providers: [
        { provide: ADMIN_OPTIONS, useValue: resolveAdminOptions(options) },
        ResourceRegistry,
        AdminAuthService,
        AdminApiService,
        AdminHttpServer,
      ],
      exports: [ResourceRegistry],
    };
  }
}

import { DashboardService } from './dashboard/dashboard.service.js';
import { WidgetRegistry } from './dashboard/widget-registry.js';
import { Module, type DynamicModule } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AdminApiService } from './api/admin-api.service.js';
import { ADMIN_OPTIONS } from './constants.js';
import { AuditReader } from './audit/audit-reader.js';
import { AdminAudit } from './audit/audit.service.js';
import { AdminAuthService } from './auth/auth.service.js';
import { AdminPolicy } from './policy/admin-policy.service.js';
import { AdminFiles } from './files/admin-files.service.js';
import { FilesService } from './files/files.service.js';
import { AdminRbac } from './rbac/rbac.service.js';
import { AdminHttpServer } from './http/admin-http.server.js';
import { resolveAdminOptions, type AdminModuleOptions } from './options.js';
import { PageRegistry } from './pages/page-registry.js';
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
        PageRegistry,
        WidgetRegistry,
        DashboardService,
        AdminAuthService,
        AdminAudit,
        AdminRbac,
        FilesService,
        AdminFiles,
        AdminPolicy,
        AdminApiService,
        AuditReader,
        AdminHttpServer,
      ],
      exports: [ResourceRegistry, AdminFiles],
    };
  }
}

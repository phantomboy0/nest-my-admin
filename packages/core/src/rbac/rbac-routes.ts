import type { ServerResponse } from 'node:http';
import type { AdminUserRecord } from '../auth/auth-adapter.js';
import type { AdminAuthService } from '../auth/auth.service.js';
import type { PermissionExplanation, RbacCatalog, RbacUser, RbacUsersResponse } from '../contract.js';
import type { AdminPolicy } from '../policy/admin-policy.service.js';
import type { ResourceRegistry } from '../registry/resource-registry.js';
import { toSessionUser } from '../http/session-user.js';
import { AdminForbiddenError, AdminNotFoundError, AdminValidationError } from '../errors.js';
import { readJsonBody, sendJson, type AdminRequest } from '../http/http-io.js';
import type { Router } from '../http/router.js';
import { RESOURCE_OPERATIONS } from '../policy/roles.js';
import type { AdminApiService } from '../api/admin-api.service.js';
import type { AdminContext } from '../resource/admin-context.js';
import type { AdminRbac, RbacManager } from './rbac.service.js';

interface State {
  req: AdminRequest;
  res: ServerResponse;
  url: URL;
  ctx: AdminContext;
}

const noContent = (res: ServerResponse) => {
  res.statusCode = 204;
  res.end();
};

/** `/api/rbac/*`: roles, groups and users (spec §6.6–6.7). Reading needs `rbac.view`, changing `rbac.manage`. */
export function addRbacRoutes<S extends State>(
  router: Router<S>,
  services: { rbac: AdminRbac; auth: AdminAuthService; api: AdminApiService; policy: AdminPolicy; registry: ResourceRegistry },
): void {
  const { rbac, auth, api, policy, registry } = services;

  const manager = (ctx: AdminContext): RbacManager => {
    if (!rbac.enabled) throw new AdminNotFoundError('Roles and groups are not stored in this admin');
    if (!ctx.permissions || !ctx.user) throw new AdminForbiddenError('Sign in first');
    return { userId: String(ctx.user.id), permissions: ctx.permissions };
  };
  const reader = (ctx: AdminContext): RbacManager => {
    const who = manager(ctx);
    if (!who.permissions.can('rbac.view') && !who.permissions.can('rbac.manage')) throw new AdminForbiddenError('You may not see roles, groups and users');
    return who;
  };
  const writer = (ctx: AdminContext): RbacManager => {
    const who = manager(ctx);
    rbac.requireManage(who);
    return who;
  };

  const toUser = async (user: AdminUserRecord): Promise<RbacUser> => ({
    id: String(user.id),
    displayName: user.displayName,
    ...(user.username ? { username: user.username } : {}),
    ...(user.email ? { email: user.email } : {}),
    isSuperuser: user.isSuperuser === true,
    ...(user.isActive !== undefined ? { isActive: user.isActive } : {}),
    ...(user.lastLoginAt !== undefined ? { lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null } : {}),
    ...(user.createdAt ? { createdAt: user.createdAt.toISOString() } : {}),
    ...(await rbac.userAssignments(String(user.id))),
  });
  const findUser = async (id: string): Promise<AdminUserRecord> => {
    const adapter = auth.adapter;
    const user = adapter?.getUser ? await adapter.getUser(id) : (await rbac.knownUserIds()).includes(id) ? { id, displayName: id, isSuperuser: false } : null;
    if (!user) throw new AdminNotFoundError(`User "${id}" not found`);
    return user;
  };
  /** Only superusers change superusers or make someone one. */
  const guardSuperuser = (who: RbacManager, target: { isSuperuser: boolean }, wants?: boolean) => {
    if (who.permissions.superuser) return;
    if (target.isSuperuser) throw new AdminForbiddenError('Only superusers may change a superuser');
    if (wants === true) throw new AdminForbiddenError('Only superusers may make someone a superuser');
  };

  router
    .add('GET', '/api/rbac/catalog', ({ res, ctx }) => {
      reader(ctx);
      const catalog = rbac.catalog();
      const body: RbacCatalog = {
        operations: [...RESOURCE_OPERATIONS],
        resources: [...catalog.resources.entries()].map(([name, info]) => {
          const schema = api.schema(name, ctx.locale);
          return {
            name,
            label: schema.label,
            group: schema.group,
            fields: info.fields.map((field) => ({ name: field, label: schema.fields.find((candidate) => candidate.name === field)?.label ?? field, restricted: (info.restricted ?? []).includes(field) })),
            scopes: info.scopes,
            custom: info.custom,
          };
        }),
        global: catalog.global,
      };
      sendJson(res, 200, body);
    })
    .add('GET', '/api/rbac/explain', async ({ res, url, ctx }) => {
      reader(ctx);
      const userId = url.searchParams.get('user');
      const resource = url.searchParams.get('resource');
      const errors: Record<string, string[]> = {};
      if (!userId) errors.user = ['is required'];
      if (!resource) errors.resource = ['is required'];
      if (Object.keys(errors).length > 0) throw new AdminValidationError(errors);
      const user = await findUser(userId!);
      const entry = registry.get(resource!);
      const record = url.searchParams.get('record') ?? undefined;
      const explained = await policy.explain(user, entry, api.schema(entry.schema.name, ctx.locale), ctx.request, ctx.locale, record);
      const body: PermissionExplanation = { user: toSessionUser(user), ...explained };
      sendJson(res, 200, body);
    })
    .add('GET', '/api/rbac/roles', async ({ res, ctx }) => {
      reader(ctx);
      sendJson(res, 200, { items: await rbac.listRoles() });
    })
    .add('GET', '/api/rbac/roles/export', async ({ res, ctx }) => {
      reader(ctx);
      sendJson(res, 200, await rbac.exportRoles());
    })
    .add('POST', '/api/rbac/roles/import', async ({ req, res, ctx }) => {
      sendJson(res, 200, await rbac.importRoles(await readJsonBody(req), writer(ctx)));
    })
    .add('POST', '/api/rbac/roles', async ({ req, res, ctx }) => {
      sendJson(res, 201, await rbac.saveRole(await readJsonBody(req), writer(ctx), 'create'));
    })
    .add('GET', '/api/rbac/roles/:name', async ({ res, ctx }, p) => {
      reader(ctx);
      const role = (await rbac.listRoles()).find((candidate) => candidate.name === p.name);
      if (!role) throw new AdminNotFoundError(`Role "${p.name}" not found`);
      sendJson(res, 200, role);
    })
    .add('PATCH', '/api/rbac/roles/:name', async ({ req, res, ctx }, p) => {
      sendJson(res, 200, await rbac.saveRole(await readJsonBody(req), writer(ctx), 'update', p.name));
    })
    .add('DELETE', '/api/rbac/roles/:name', async ({ res, ctx }, p) => {
      await rbac.deleteRole(p.name!, writer(ctx));
      noContent(res);
    })
    .add('GET', '/api/rbac/groups', async ({ res, ctx }) => {
      reader(ctx);
      sendJson(res, 200, { items: await rbac.listGroups() });
    })
    .add('POST', '/api/rbac/groups', async ({ req, res, ctx }) => {
      sendJson(res, 201, await rbac.saveGroup(await readJsonBody(req), writer(ctx)));
    })
    .add('GET', '/api/rbac/groups/:id', async ({ res, ctx }, p) => {
      reader(ctx);
      sendJson(res, 200, await rbac.getGroup(groupId(p.id!)));
    })
    .add('PATCH', '/api/rbac/groups/:id', async ({ req, res, ctx }, p) => {
      sendJson(res, 200, await rbac.saveGroup(await readJsonBody(req), writer(ctx), groupId(p.id!)));
    })
    .add('DELETE', '/api/rbac/groups/:id', async ({ res, ctx }, p) => {
      await rbac.deleteGroup(groupId(p.id!), writer(ctx));
      noContent(res);
    })
    .add('GET', '/api/rbac/users', async ({ res, url, ctx }) => {
      reader(ctx);
      const adapter = auth.adapter;
      const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize')) || 25));
      const search = url.searchParams.get('search')?.trim() || undefined;
      let listed: { items: AdminUserRecord[]; total: number };
      if (adapter?.listUsers) listed = await adapter.listUsers({ search, page, pageSize });
      else {
        // Adapters that cannot list users: those that have roles or groups here.
        const ids = (await rbac.knownUserIds()).filter((id) => !search || id.toLowerCase().includes(search.toLowerCase()));
        listed = { items: ids.slice((page - 1) * pageSize, page * pageSize).map((id) => ({ id, displayName: id, isSuperuser: false })), total: ids.length };
      }
      const body: RbacUsersResponse = {
        items: await Promise.all(listed.items.map(toUser)),
        total: listed.total,
        page,
        pageSize,
        capabilities: { list: Boolean(adapter?.listUsers), create: Boolean(adapter?.createUser), update: Boolean(adapter?.updateUser), password: Boolean(adapter?.setPassword) },
      };
      sendJson(res, 200, body);
    })
    .add('POST', '/api/rbac/users', async ({ req, res, ctx }) => {
      const who = writer(ctx);
      const adapter = auth.adapter;
      if (!adapter?.createUser) throw new AdminNotFoundError('This admin cannot create users');
      const body = ((await readJsonBody(req)) ?? {}) as Record<string, unknown>;
      const errors: Record<string, string[]> = {};
      for (const key of ['username', 'displayName', 'password'] as const) if (typeof body[key] !== 'string' || (body[key] as string).trim() === '') errors[key] = ['is required'];
      if (body.email !== undefined && body.email !== null && typeof body.email !== 'string') errors.email = ['must be text'];
      if (Object.keys(errors).length > 0) throw new AdminValidationError(errors);
      guardSuperuser(who, { isSuperuser: false }, body.isSuperuser === true);
      const created = await adapter.createUser({
        username: body.username as string,
        displayName: body.displayName as string,
        email: (body.email as string | null | undefined) ?? null,
        password: body.password as string,
        isSuperuser: body.isSuperuser === true,
      });
      if (body.roles !== undefined || body.groups !== undefined) {
        await rbac.setUserAssignments(String(created.id), { roles: body.roles, groups: body.groups }, who, { isSuperuser: created.isSuperuser });
      }
      sendJson(res, 201, await toUser(created));
    })
    .add('GET', '/api/rbac/users/:id', async ({ res, ctx }, p) => {
      reader(ctx);
      sendJson(res, 200, await toUser(await findUser(p.id!)));
    })
    .add('PATCH', '/api/rbac/users/:id', async ({ req, res, ctx }, p) => {
      const who = writer(ctx);
      const target = await findUser(p.id!);
      const body = ((await readJsonBody(req)) ?? {}) as Record<string, unknown>;
      const profile: Record<string, unknown> = {};
      for (const key of ['displayName', 'email', 'isActive', 'isSuperuser'] as const) if (body[key] !== undefined) profile[key] = body[key];
      if (Object.keys(profile).length > 0) {
        guardSuperuser(who, target, profile.isSuperuser === true);
        if (String(target.id) === who.userId && (profile.isActive === false || profile.isSuperuser === false)) {
          throw new AdminForbiddenError('You may not deactivate yourself or drop your own superuser status');
        }
        const adapter = auth.adapter;
        if (!adapter?.updateUser) throw new AdminNotFoundError('This admin cannot change users');
        await adapter.updateUser(String(target.id), profile);
      }
      if (body.roles !== undefined || body.groups !== undefined) {
        await rbac.setUserAssignments(String(target.id), { roles: body.roles, groups: body.groups }, who, { isSuperuser: target.isSuperuser });
      }
      sendJson(res, 200, await toUser(await findUser(p.id!)));
    })
    .add('POST', '/api/rbac/users/:id/password', async ({ req, res, ctx }, p) => {
      const who = writer(ctx);
      const target = await findUser(p.id!);
      guardSuperuser(who, target);
      const adapter = auth.adapter;
      if (!adapter?.setPassword) throw new AdminNotFoundError('This admin cannot set passwords');
      const { password } = ((await readJsonBody(req)) ?? {}) as { password?: unknown };
      if (typeof password !== 'string' || password === '') throw new AdminValidationError({ password: ['is required'] });
      await adapter.setPassword(String(target.id), password);
      noContent(res);
    });
}

function groupId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw new AdminNotFoundError(`Group "${raw}" not found`);
  return id;
}

import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { In, type DataSource } from 'typeorm';
import { ADMIN_OPTIONS } from '../constants.js';
import { AdminForbiddenError, AdminNotFoundError, AdminValidationError } from '../errors.js';
import type { LocalizedText } from '../i18n/localized-text.js';
import type { ResolvedAdminOptions } from '../options.js';
import { buildCatalog } from '../policy/catalog.js';
import type { EffectivePermissions } from '../policy/effective.js';
import { checkRoles, type PolicyCatalog, type RoleDefinition } from '../policy/roles.js';
import { ResourceRegistry } from '../registry/resource-registry.js';
import { ADMIN_RBAC_ENTITIES, NmaGroup, NmaGroupMember, NmaGroupRole, NmaRole, NmaUserRole } from './entities.js';
import { escalations } from './escalation.js';

/** A role as the admin shows and edits it. */
export interface RoleRecord extends RoleDefinition {
  system: boolean;
}

export interface GroupRecord {
  id: number;
  name: string;
  label: LocalizedText | null;
  roles: string[];
  members: string[];
}

/** Who asks for an RBAC change: their permissions (anti-escalation) and their own user id (no self-grants). */
export interface RbacManager {
  userId: string;
  permissions: EffectivePermissions;
}

const NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/i;

/**
 * Roles, groups and memberships in the database (spec §6.6, D3). Every change goes through here: validation against
 * the catalog, anti-escalation, and invalidation of the cached permissions (`permissionsVersion`).
 */
@Injectable()
export class AdminRbac implements OnApplicationBootstrap {
  private readonly logger = new Logger('NestMyAdmin');
  private dataSource?: DataSource;
  private versionValue = 0;
  private rolesCache?: { version: number; roles: Promise<Map<string, RoleRecord>> };
  private readonly assigned = new Map<string, { version: number; names: Promise<string[]> }>();
  private readonly warned = new Set<string>();

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly registry: ResourceRegistry,
    @Inject(ADMIN_OPTIONS) private readonly options: ResolvedAdminOptions,
  ) {}

  get enabled(): boolean {
    return this.options.rbac !== undefined;
  }

  /** Changes whenever roles, groups or memberships change (the UI refetches its permissions). */
  get permissionsVersion(): number {
    return this.versionValue;
  }

  catalog(): PolicyCatalog {
    return buildCatalog(this.registry, this.options);
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.options.rbac) return;
    const name = this.options.rbac.dataSource;
    try {
      this.dataSource = this.moduleRef.get<DataSource>(getDataSourceToken(name) as string, { strict: false });
    } catch {
      throw new Error(`nest-my-admin: rbac: no TypeORM DataSource "${name ?? 'default'}"`);
    }
    for (const entity of ADMIN_RBAC_ENTITIES) {
      if (!this.dataSource.hasMetadata(entity)) {
        throw new Error(`nest-my-admin: rbac: add ADMIN_RBAC_ENTITIES to the entities of the DataSource "${name ?? 'default'}" (${entity.name} is missing)`);
      }
    }
    await this.syncSystemRoles();
  }

  private get db(): DataSource {
    if (!this.dataSource) throw new AdminNotFoundError('Roles and groups are not stored in this admin (no `rbac` option)');
    return this.dataSource;
  }

  /** Code roles are the truth for system roles: written at every boot; a code role that went away becomes editable. */
  private async syncSystemRoles(): Promise<void> {
    await this.db.transaction(async (manager) => {
      const repository = manager.getRepository(NmaRole);
      const codeNames = new Set(this.options.roles.map((role) => role.name));
      for (const role of this.options.roles) {
        await repository.save(
          repository.create({
            name: role.name,
            label: role.label ?? null,
            description: role.description ?? null,
            system: true,
            definition: { permissions: role.permissions, ...(role.fields ? { fields: role.fields } : {}), ...(role.scopes ? { scopes: role.scopes } : {}) },
          }),
        );
      }
      for (const stale of await repository.find({ where: { system: true } })) {
        if (!codeNames.has(stale.name)) await repository.update({ name: stale.name }, { system: false });
      }
    });
    this.invalidate();
  }

  invalidate(): void {
    this.versionValue += 1;
    this.rolesCache = undefined;
    this.assigned.clear();
  }

  /** Every role by name: code roles, and stored roles that still validate (others are skipped with a warning). */
  roles(): Promise<Map<string, RoleRecord>> {
    if (this.rolesCache?.version === this.versionValue) return this.rolesCache.roles;
    const roles = this.loadRoles();
    this.rolesCache = { version: this.versionValue, roles };
    roles.catch(() => (this.rolesCache = undefined));
    return roles;
  }

  private async loadRoles(): Promise<Map<string, RoleRecord>> {
    const roles = new Map<string, RoleRecord>(this.options.roles.map((role) => [role.name, { ...role, system: true }]));
    if (!this.dataSource) return roles;
    const catalog = this.catalog();
    for (const row of await this.db.getRepository(NmaRole).find()) {
      if (roles.has(row.name)) continue; // system: code wins
      const role = toRole(row);
      try {
        checkRoles([role], catalog, (message) => {
          throw new Error(message);
        });
        roles.set(role.name, role);
      } catch (error) {
        this.warnOnce(`stored role "${row.name}" no longer matches the resources (${error instanceof Error ? error.message : String(error)}); it grants nothing until fixed`);
      }
    }
    return roles;
  }

  /** Role names assigned in the database: directly and through the user's groups. */
  assignedRoleNames(userId: string): Promise<string[]> {
    if (!this.dataSource) return Promise.resolve([]);
    const cached = this.assigned.get(userId);
    if (cached?.version === this.versionValue) return cached.names;
    const names = (async () => {
      const direct = await this.db.getRepository(NmaUserRole).find({ where: { userId } });
      const groups = await this.db.getRepository(NmaGroupMember).find({ where: { userId } });
      const viaGroups = groups.length > 0 ? await this.db.getRepository(NmaGroupRole).find({ where: { groupId: In(groups.map((group) => group.groupId)) } }) : [];
      return [...new Set([...direct.map((row) => row.roleName), ...viaGroups.map((row) => row.roleName)])];
    })();
    this.assigned.set(userId, { version: this.versionValue, names });
    names.catch(() => this.assigned.delete(userId));
    return names;
  }

  // ---- roles ----------------------------------------------------------------------------------------------------

  async listRoles(): Promise<RoleRecord[]> {
    const roles = await this.roles();
    const stored = this.dataSource ? await this.db.getRepository(NmaRole).find({ order: { name: 'ASC' } }) : [];
    // Invalid stored roles are listed too (so they can be fixed), with their stored definition.
    const byName = new Map(roles);
    for (const row of stored) if (!byName.has(row.name)) byName.set(row.name, toRole(row));
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Creates or replaces a non-system role after validation and anti-escalation. */
  async saveRole(input: unknown, manager: RbacManager, mode: 'create' | 'update', name?: string): Promise<RoleRecord> {
    const role = parseRole(input, mode === 'update' ? name : undefined);
    this.requireManage(manager);
    const repository = this.db.getRepository(NmaRole);
    const existing = await repository.findOne({ where: { name: role.name } });
    if (mode === 'create' && existing) throw new AdminValidationError({ name: ['is taken'] });
    if (mode === 'update' && !existing) throw new AdminNotFoundError(`Role "${role.name}" not found`);
    if (existing?.system || this.options.roles.some((code) => code.name === role.name)) throw new AdminForbiddenError(`"${role.name}" is a system role: change it in code`);
    this.validate(role);
    this.requireWithin(role, manager, 'grant');
    if (existing) this.requireWithin(toRole(existing), manager, 'change');
    await repository.save(
      repository.create({ name: role.name, label: role.label ?? null, description: role.description ?? null, system: false, definition: definitionOf(role) }),
    );
    this.invalidate();
    return { ...role, system: false };
  }

  async deleteRole(name: string, manager: RbacManager): Promise<void> {
    this.requireManage(manager);
    const existing = await this.db.getRepository(NmaRole).findOne({ where: { name } });
    if (!existing) throw new AdminNotFoundError(`Role "${name}" not found`);
    if (existing.system) throw new AdminForbiddenError(`"${name}" is a system role: remove it in code`);
    this.requireWithin(toRole(existing), manager, 'delete');
    await this.db.transaction(async (tx) => {
      await tx.getRepository(NmaUserRole).delete({ roleName: name });
      await tx.getRepository(NmaGroupRole).delete({ roleName: name });
      await tx.getRepository(NmaRole).delete({ name });
    });
    this.invalidate();
  }

  /** Roles that are not system roles, as JSON for another admin (spec §6.6). */
  async exportRoles(): Promise<{ version: 1; roles: RoleDefinition[] }> {
    const roles = (await this.listRoles()).filter((role) => !role.system).map(({ system: _system, ...role }) => role);
    return { version: 1, roles };
  }

  /** All or nothing: every role validates and stays within the manager's permissions, or nothing is written. */
  async importRoles(input: unknown, manager: RbacManager): Promise<{ imported: string[] }> {
    this.requireManage(manager);
    const list = (input as { roles?: unknown } | null)?.roles;
    if (!Array.isArray(list) || list.length > 500) throw new AdminValidationError({ roles: ['must be a list of at most 500 roles'] });
    const roles = list.map((item, index) => {
      try {
        return parseRole(item);
      } catch (error) {
        throw error instanceof AdminValidationError ? new AdminValidationError(prefix(error.fields ?? {}, `roles.${index}`), `Role ${index + 1} is not valid`) : error;
      }
    });
    const names = new Set<string>();
    for (const role of roles) {
      if (names.has(role.name)) throw new AdminValidationError({ roles: [`"${role.name}" appears twice`] });
      names.add(role.name);
      if (this.options.roles.some((code) => code.name === role.name)) throw new AdminForbiddenError(`"${role.name}" is a system role`);
      this.validate(role);
      this.requireWithin(role, manager, 'grant');
    }
    const repository = this.db.getRepository(NmaRole);
    for (const existing of await repository.find({ where: { name: In([...names]) } })) {
      if (existing.system) throw new AdminForbiddenError(`"${existing.name}" is a system role`);
      this.requireWithin(toRole(existing), manager, 'change');
    }
    await this.db.transaction(async (tx) => {
      for (const role of roles) {
        await tx.getRepository(NmaRole).save(
          tx.getRepository(NmaRole).create({ name: role.name, label: role.label ?? null, description: role.description ?? null, system: false, definition: definitionOf(role) }),
        );
      }
    });
    this.invalidate();
    return { imported: roles.map((role) => role.name) };
  }

  // ---- groups ---------------------------------------------------------------------------------------------------

  async listGroups(): Promise<GroupRecord[]> {
    const groups = await this.db.getRepository(NmaGroup).find({ order: { name: 'ASC' } });
    const roles = await this.db.getRepository(NmaGroupRole).find();
    const members = await this.db.getRepository(NmaGroupMember).find();
    return groups.map((group) => ({
      id: group.id,
      name: group.name,
      label: group.label,
      roles: roles.filter((row) => row.groupId === group.id).map((row) => row.roleName).sort(),
      members: members.filter((row) => row.groupId === group.id).map((row) => row.userId).sort(),
    }));
  }

  async getGroup(id: number): Promise<GroupRecord> {
    const group = (await this.listGroups()).find((candidate) => candidate.id === id);
    if (!group) throw new AdminNotFoundError(`Group ${id} not found`);
    return group;
  }

  /** Creates or updates a group; the roles it holds must be within the manager's permissions, and so must changes to its members. */
  async saveGroup(input: unknown, manager: RbacManager, id?: number): Promise<GroupRecord> {
    this.requireManage(manager);
    const body = (input ?? {}) as { name?: unknown; label?: unknown; roles?: unknown; members?: unknown };
    const errors: Record<string, string[]> = {};
    if (id === undefined || body.name !== undefined) {
      if (typeof body.name !== 'string' || !NAME.test(body.name)) errors.name = ['must be 1–100 letters, digits, . _ -'];
    }
    const roles = body.roles === undefined ? undefined : stringList(body.roles, 'roles', errors);
    const members = body.members === undefined ? undefined : stringList(body.members, 'members', errors);
    if (Object.keys(errors).length > 0) throw new AdminValidationError(errors);
    const existing = id === undefined ? undefined : await this.getGroup(id);
    const known = await this.roles();
    for (const name of roles ?? []) if (!known.has(name)) throw new AdminValidationError({ roles: [`"${name}" is not a role`] });
    // Whatever the group will hold goes to its members: it must be within the manager's permissions.
    const finalRoles = roles ?? existing?.roles ?? [];
    const changesRoles = roles !== undefined && JSON.stringify([...roles].sort()) !== JSON.stringify(existing?.roles ?? []);
    const changesMembers = members !== undefined && JSON.stringify([...members].sort()) !== JSON.stringify(existing?.members ?? []);
    if (changesRoles || changesMembers) for (const name of finalRoles) this.requireWithin(known.get(name)!, manager, 'assign');
    if (!manager.permissions.superuser && members && members.includes(manager.userId) && !(existing?.members ?? []).includes(manager.userId)) {
      throw new AdminForbiddenError('You may not add yourself to a group');
    }
    const saved = await this.db.transaction(async (tx) => {
      const groups = tx.getRepository(NmaGroup);
      if (typeof body.name === 'string') {
        const clash = await groups.findOne({ where: { name: body.name } });
        if (clash && clash.id !== id) throw new AdminValidationError({ name: ['is taken'] });
      }
      const group =
        id === undefined
          ? await groups.save(groups.create({ name: body.name as string, label: (body.label as LocalizedText | undefined) ?? null }))
          : await groups.save({ id, ...(typeof body.name === 'string' ? { name: body.name } : {}), ...(body.label !== undefined ? { label: body.label as LocalizedText | null } : {}) });
      if (roles !== undefined) {
        await tx.getRepository(NmaGroupRole).delete({ groupId: group.id });
        if (roles.length > 0) await tx.getRepository(NmaGroupRole).insert(roles.map((roleName) => ({ groupId: group.id, roleName })));
      }
      if (members !== undefined) {
        await tx.getRepository(NmaGroupMember).delete({ groupId: group.id });
        if (members.length > 0) await tx.getRepository(NmaGroupMember).insert(members.map((userId) => ({ groupId: group.id, userId })));
      }
      return group;
    });
    this.invalidate();
    return this.getGroup(saved.id);
  }

  async deleteGroup(id: number, manager: RbacManager): Promise<void> {
    this.requireManage(manager);
    const group = await this.getGroup(id);
    const known = await this.roles();
    for (const name of group.roles) if (known.has(name)) this.requireWithin(known.get(name)!, manager, 'change');
    await this.db.transaction(async (tx) => {
      await tx.getRepository(NmaGroupRole).delete({ groupId: id });
      await tx.getRepository(NmaGroupMember).delete({ groupId: id });
      await tx.getRepository(NmaGroup).delete({ id });
    });
    this.invalidate();
  }

  // ---- users ----------------------------------------------------------------------------------------------------

  async userAssignments(userId: string): Promise<{ roles: string[]; groups: number[] }> {
    const roles = await this.db.getRepository(NmaUserRole).find({ where: { userId } });
    const groups = await this.db.getRepository(NmaGroupMember).find({ where: { userId } });
    return { roles: roles.map((row) => row.roleName).sort(), groups: groups.map((row) => row.groupId).sort((a, b) => a - b) };
  }

  /** Replaces a user's direct roles and/or groups. Never your own (unless superuser), never beyond your permissions. */
  async setUserAssignments(userId: string, input: { roles?: unknown; groups?: unknown }, manager: RbacManager, target: { isSuperuser: boolean }): Promise<void> {
    this.requireManage(manager);
    if (!manager.permissions.superuser) {
      if (userId === manager.userId) throw new AdminForbiddenError('You may not change your own roles or groups');
      if (target.isSuperuser) throw new AdminForbiddenError('Only superusers may change a superuser');
    }
    const errors: Record<string, string[]> = {};
    const roles = input.roles === undefined ? undefined : stringList(input.roles, 'roles', errors);
    const groups = input.groups === undefined ? undefined : numberList(input.groups, 'groups', errors);
    if (Object.keys(errors).length > 0) throw new AdminValidationError(errors);
    const known = await this.roles();
    const current = await this.userAssignments(userId);
    for (const name of roles ?? []) {
      if (!known.has(name)) throw new AdminValidationError({ roles: [`"${name}" is not a role`] });
      if (!current.roles.includes(name)) this.requireWithin(known.get(name)!, manager, 'assign');
    }
    for (const name of current.roles) if (roles && !roles.includes(name) && known.has(name)) this.requireWithin(known.get(name)!, manager, 'change');
    if (groups) {
      const all = await this.listGroups();
      for (const groupId of groups) {
        const group = all.find((candidate) => candidate.id === groupId);
        if (!group) throw new AdminValidationError({ groups: [`group ${groupId} does not exist`] });
        if (!current.groups.includes(groupId)) for (const name of group.roles) if (known.has(name)) this.requireWithin(known.get(name)!, manager, 'assign');
      }
    }
    await this.db.transaction(async (tx) => {
      if (roles !== undefined) {
        await tx.getRepository(NmaUserRole).delete({ userId });
        if (roles.length > 0) await tx.getRepository(NmaUserRole).insert(roles.map((roleName) => ({ userId, roleName })));
      }
      if (groups !== undefined) {
        await tx.getRepository(NmaGroupMember).delete({ userId });
        if (groups.length > 0) await tx.getRepository(NmaGroupMember).insert(groups.map((groupId) => ({ groupId, userId })));
      }
    });
    this.invalidate();
  }

  /** User ids that appear in memberships (the users list of adapters that cannot list users). */
  async knownUserIds(): Promise<string[]> {
    const direct = await this.db.getRepository(NmaUserRole).find();
    const members = await this.db.getRepository(NmaGroupMember).find();
    return [...new Set([...direct.map((row) => row.userId), ...members.map((row) => row.userId)])].sort();
  }

  // ---- checks ---------------------------------------------------------------------------------------------------

  requireManage(manager: RbacManager): void {
    if (!manager.permissions.can('rbac.manage')) throw new AdminForbiddenError('You may not manage roles, groups and users');
  }

  private validate(role: RoleDefinition): void {
    try {
      checkRoles([role], this.catalog(), (message) => {
        throw new AdminValidationError({ definition: [message.replace(/^roles\.[^.:]+\.?/, '')] }, message);
      });
    } catch (error) {
      if (error instanceof AdminValidationError) throw error;
      throw new AdminValidationError({ definition: [error instanceof Error ? error.message : String(error)] });
    }
  }

  /** 403 when the role would give more than the manager has (spec §6.5). */
  private requireWithin(role: RoleDefinition, manager: RbacManager, verb: 'grant' | 'assign' | 'change' | 'delete'): void {
    const problems = escalations(role, manager.permissions, this.catalog());
    if (problems.length > 0) {
      const what = { grant: 'grant', assign: 'assign', change: 'change', delete: 'delete' }[verb];
      throw new AdminForbiddenError(`You may not ${what} "${role.name}": it ${problems.slice(0, 5).join('; it ')}${problems.length > 5 ? '; …' : ''}`);
    }
  }

  private warnOnce(message: string): void {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    this.logger.warn(message);
  }
}

function toRole(row: NmaRole): RoleRecord {
  return {
    name: row.name,
    ...(row.label !== null ? { label: row.label } : {}),
    ...(row.description !== null ? { description: row.description } : {}),
    permissions: Array.isArray(row.definition?.permissions) ? row.definition.permissions : [],
    ...(row.definition?.fields ? { fields: row.definition.fields } : {}),
    ...(row.definition?.scopes ? { scopes: row.definition.scopes } : {}),
    system: row.system,
  };
}

function definitionOf(role: RoleDefinition): NmaRole['definition'] {
  return { permissions: role.permissions, ...(role.fields ? { fields: role.fields } : {}), ...(role.scopes ? { scopes: role.scopes } : {}) };
}

/** A role from a request body: shape checks only (the catalog checks come after). */
function parseRole(input: unknown, name?: string): RoleDefinition {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new AdminValidationError({ role: ['must be an object'] });
  const body = input as Record<string, unknown>;
  const errors: Record<string, string[]> = {};
  const roleName = name ?? body.name;
  if (typeof roleName !== 'string' || !NAME.test(roleName)) errors.name = ['must be 1–100 letters, digits, . _ -'];
  if (!Array.isArray(body.permissions) || body.permissions.some((code) => typeof code !== 'string') || body.permissions.length > 2000) errors.permissions = ['must be a list of permission codes'];
  for (const key of ['fields', 'scopes'] as const) {
    if (body[key] !== undefined && (typeof body[key] !== 'object' || body[key] === null || Array.isArray(body[key]))) errors[key] = ['must be an object'];
  }
  for (const key of ['label', 'description'] as const) {
    const value = body[key];
    if (value !== undefined && value !== null && typeof value !== 'string' && (typeof value !== 'object' || Array.isArray(value))) errors[key] = ['must be text or { en, fa, … }'];
  }
  if (Object.keys(errors).length > 0) throw new AdminValidationError(errors);
  return {
    name: roleName as string,
    ...(body.label ? { label: body.label as LocalizedText } : {}),
    ...(body.description ? { description: body.description as LocalizedText } : {}),
    permissions: [...new Set(body.permissions as string[])],
    ...(body.fields ? { fields: body.fields as RoleDefinition['fields'] } : {}),
    ...(body.scopes ? { scopes: body.scopes as RoleDefinition['scopes'] } : {}),
  };
}

function stringList(value: unknown, key: string, errors: Record<string, string[]>): string[] {
  if (!Array.isArray(value) || value.length > 1000 || value.some((item) => typeof item !== 'string' || item === '' || item.length > 100)) {
    errors[key] = ['must be a list of names'];
    return [];
  }
  return [...new Set(value as string[])];
}

function numberList(value: unknown, key: string, errors: Record<string, string[]>): number[] {
  if (!Array.isArray(value) || value.length > 1000 || value.some((item) => !Number.isInteger(item))) {
    errors[key] = ['must be a list of ids'];
    return [];
  }
  return [...new Set(value as number[])];
}

function prefix(fields: Record<string, string[]>, path: string): Record<string, string[]> {
  return Object.fromEntries(Object.entries(fields).map(([key, messages]) => [`${path}.${key}`, messages]));
}


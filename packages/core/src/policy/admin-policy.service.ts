import { visibleTabs } from '../crud/list-tabs.js';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Brackets, type EntityManager, type SelectQueryBuilder, type WhereExpressionBuilder } from 'typeorm';
import { ADMIN_OPTIONS, ADMIN_RESOURCE_METADATA } from '../constants.js';
import type { AdminRecord, ExplainRoleSource, FieldSchema, FormLayoutInline, FormLayoutNode, FormLayoutSection, PermissionExplanation, RecordPermissions, ResourceSchema } from '../contract.js';
import { recordIdOf } from '../crud/record-id.js';
import type { RegisteredAction } from '../decorators/admin-action.js';
import { getCanRules, getScopes, type RecordOperation, type ScopeCondition } from '../decorators/admin-scope.js';
import type { AdminResourceDefinition } from '../decorators/admin-resource.js';
import { AdminForbiddenError, AdminForbiddenFieldsError, AdminNotFoundError } from '../errors.js';
import type { AdminUser } from '../auth/auth-adapter.js';
import { AdminAuthService } from '../auth/auth.service.js';
import type { GlobalScope, ResolvedAdminOptions } from '../options.js';
import { resolveText } from '../i18n/localized-text.js';
import { PageRegistry, unknownPage, type RegisteredPage } from '../pages/page-registry.js';
import { ResourceRegistry, type RegisteredResource } from '../registry/resource-registry.js';
import { createAdminContext, type AdminContext } from '../resource/admin-context.js';
import type { RecordId } from '../resource/admin-resource-base.js';
import { AdminRbac } from '../rbac/rbac.service.js';
import { buildCatalog, customCodes } from './catalog.js';
import { EffectivePermissions, type FieldLevel } from './effective.js';
import { explainPermissions } from './explain.js';
import { RESOURCE_OPERATIONS, actionCode, checkRoles, type ResourceOperation, type RoleDefinition, type ScopedOperation } from './roles.js';

const RANK: Record<FieldLevel, number> = { hidden: 0, view: 1, edit: 2 };
const OPEN: EffectivePermissions = new EffectivePermissions([], true);

/** What the user may do with one resource: its schema cut to them, and the level of every field and path. */
export interface ResourceView {
  schema: ResourceSchema;
  levels: Map<string, FieldLevel>;
}

/**
 * The one place permissions are decided (spec §6.5): effective permissions per request, schemas cut to the user,
 * row scopes on every query, and the checks the API runs before a resource method.
 */
@Injectable()
export class AdminPolicy implements OnApplicationBootstrap {
  private readonly logger = new Logger('NestMyAdmin');
  private readonly warned = new Set<string>();
  private parameter = 0;

  constructor(
    private readonly registry: ResourceRegistry,
    private readonly auth: AdminAuthService,
    private readonly rbac: AdminRbac,
    private readonly pages: PageRegistry,
    @Inject(ADMIN_OPTIONS) private readonly options: ResolvedAdminOptions,
  ) {}

  onApplicationBootstrap(): void {
    for (const entry of this.registry.list()) {
      const custom = customCodes(entry);
      for (const code of custom) {
        if (!/^[a-z][a-z0-9_]*$/i.test(code) || (RESOURCE_OPERATIONS as readonly string[]).includes(code) || code === 'field' || code === 'action') {
          throw new Error(`${entry.className}: permission "${code}" must be a word (letters, digits, _) other than ${RESOURCE_OPERATIONS.join(', ')}, field and action`);
        }
      }
      const scopes = getScopes(entry.resource.constructor);
      for (const [name, key] of Object.entries(scopes)) {
        if (typeof (entry.resource as unknown as Record<string | symbol, unknown>)[key] !== 'function') throw new Error(`${entry.className}: @AdminScope("${name}") must decorate a method`);
      }
      entry.resource.attachScoper((qb, ctx) => this.applyScopes(qb, entry, 'view', ctx));
    }
    checkRoles(this.options.roles, buildCatalog(this.registry, this.options, this.pages.list().map((page) => page.name)), (message) => {
      throw new Error(`nest-my-admin: ${message}`);
    });
    if (this.auth.adapter && this.options.roles.length === 0 && !this.options.rbac) {
      this.logger.warn('Sign-in is on but no `roles` are defined: only superusers can use the admin.');
    }
  }

  /** The request's effective permissions (fail closed: a failing role lookup grants nothing). */
  async forUser(user: AdminUser | undefined): Promise<EffectivePermissions> {
    if (!user || user.isSuperuser) return user ? OPEN : new EffectivePermissions([], false);
    let names: string[] = [];
    try {
      const fromOptions = (await this.options.resolveRoles?.(user)) ?? [];
      const fromAdapter = (await this.auth.adapter?.resolveRoles?.(user)) ?? [];
      const stored = await this.rbac.assignedRoleNames(String(user.id));
      names = [...fromOptions, ...fromAdapter, ...stored];
    } catch (error) {
      this.warnOnce(`resolveRoles threw for user ${String(user.id)} (${error instanceof Error ? error.message : String(error)}); the user gets no roles`);
      names = [];
    }
    const roles: RoleDefinition[] = [];
    let known: Map<string, RoleDefinition>;
    try {
      known = await this.rbac.roles();
    } catch (error) {
      this.warnOnce(`roles could not be loaded (${error instanceof Error ? error.message : String(error)}); users get no roles`);
      known = new Map();
    }
    for (const name of new Set(names)) {
      const role = known.get(name);
      if (role) roles.push(role);
      else this.warnOnce(`resolveRoles returned "${name}", which is not a role; it is ignored`);
    }
    return new EffectivePermissions(roles, false);
  }

  /** A user's role names and where each comes from (for the debugger; `forUser` decides what they grant). */
  async roleSources(user: AdminUser): Promise<Map<string, ExplainRoleSource[]>> {
    const sources = new Map<string, ExplainRoleSource[]>();
    const add = (name: string, source: ExplainRoleSource) => sources.set(name, [...(sources.get(name) ?? []), source]);
    if (user.isSuperuser) return sources;
    for (const name of (await this.options.resolveRoles?.(user)) ?? []) add(name, { kind: 'resolveRoles' });
    for (const name of (await this.auth.adapter?.resolveRoles?.(user)) ?? []) add(name, { kind: 'adapter' });
    for (const row of await this.rbac.assignmentSources(String(user.id))) add(row.role, row.group === undefined ? { kind: 'direct' } : { kind: 'group', group: row.group });
    return sources;
  }

  /** Explains a user's permissions on a resource (spec §6.7). `request` is the explaining request. */
  async explain(user: AdminUser, entry: RegisteredResource, labels: ResourceSchema, request: AdminContext['request'], locale: string | undefined, record?: string): Promise<Omit<PermissionExplanation, 'user'>> {
    const ctx = createAdminContext(request);
    ctx.user = user;
    ctx.locale = locale;
    const permissions = await this.forUser(user);
    ctx.permissions = permissions;
    const pages = this.pages.list().map((page) => ({ name: page.name, label: resolveText(page.label, locale ?? this.options.locale, this.options.locale) }));
    return explainPermissions(this, { user, entry, labels, pages, ctx: ctx as AdminContext & { permissions: EffectivePermissions }, sources: await this.roleSources(user), record });
  }

  permissionsOf(ctx: AdminContext): EffectivePermissions {
    return ctx.permissions ?? OPEN; // no request (host code calling the service directly): unrestricted, as before
  }

  /** 404 when the user cannot reach the resource at all (it is not in their meta either). */
  requireReach(entry: RegisteredResource, ctx: AdminContext): void {
    if (!this.permissionsOf(ctx).canReach(entry.schema.name)) throw new AdminNotFoundError(`Unknown resource "${entry.schema.name}"`);
  }

  /** 404 without any access, 403 without this operation. */
  require(entry: RegisteredResource, operation: ResourceOperation, ctx: AdminContext): void {
    this.requireReach(entry, ctx);
    if (operation !== 'view' && entry.schema.readonly) throw new AdminForbiddenError(`${entry.schema.label} records are read-only`);
    if (!this.permissionsOf(ctx).canOn(entry.schema.name, operation)) {
      throw new AdminForbiddenError(`You may not ${operation === 'view' ? 'view' : operation} ${entry.schema.label} records`);
    }
  }

  /**
   * Whether the user is offered an action at all: they can reach the resource, hold `{resource}.action.{name}`
   * (`{resource}.*` covers it), and for a record action `{resource}.update` too, since it changes records. Records
   * narrow it (`_perm.actions`).
   */
  canRunAction(entry: RegisteredResource, action: Pick<RegisteredAction, 'name' | 'target'>, ctx: AdminContext): boolean {
    const perms = this.permissionsOf(ctx);
    if (!perms.canReach(entry.schema.name) || !perms.can(actionCode(entry.schema.name, action.name))) return false;
    return action.target === 'resource' || perms.canOn(entry.schema.name, 'update');
  }

  /** 404 without any access to the resource, 403 without the action (or, for a record action, without `update`). */
  requireAction(entry: RegisteredResource, action: Pick<RegisteredAction, 'name' | 'target'>, label: string, ctx: AdminContext): void {
    this.requireReach(entry, ctx);
    if (!this.canRunAction(entry, action, ctx)) throw new AdminForbiddenError(`You may not run "${label}" on ${entry.schema.label} records`);
  }

  /** Whether the user may view (`page.{name}`) or save (`page.{name}.update`, which includes viewing) a settings page. */
  canPage(page: RegisteredPage, operation: 'view' | 'update', ctx: AdminContext): boolean {
    return this.permissionsOf(ctx).canPage(page.name, operation);
  }

  /** 404 when the user may not view the page (it is not in their meta either), 403 when they may view but not save it. */
  requirePage(page: RegisteredPage, operation: 'view' | 'update', ctx: AdminContext): void {
    if (!this.canPage(page, 'view', ctx)) throw unknownPage(page.name);
    if (operation === 'update' && !this.canPage(page, 'update', ctx)) {
      throw new AdminForbiddenError(`You may not change ${resolveText(page.label, ctx.locale ?? this.options.locale, this.options.locale)}`);
    }
  }

  /** Levels of every field and path of the resource, for this user. */
  levels(entry: RegisteredResource, ctx: AdminContext): Map<string, FieldLevel> {
    const perms = this.permissionsOf(ctx);
    const levels = new Map<string, FieldLevel>();
    const { schema } = entry;
    for (const field of topLevelFields(schema)) {
      let level = perms.fieldLevel(schema.name, field.name, entry.fieldConfig.get(field.name)?.restricted === true);
      // Keys and the version stay visible: ids are in `_id` anyway, and If-Match needs the version.
      if ((field.primary || field.name === schema.version) && level === 'hidden') level = 'view';
      levels.set(field.name, level);
    }
    for (const field of schema.fields) if (field.name.includes('.')) levels.set(field.name, this.pathLevel(entry, field.name, levels, ctx));
    return levels;
  }

  /**
   * The computed columns (`list.computed`) this user may see (spec §5.4, Review Focus 2): every field, path and child
   * entity a column reads must be visible to them; a child with a resource needs its view permission and fields.
   */
  computedVisible(entry: RegisteredResource, ctx: AdminContext, levels = this.levels(entry, ctx)): Set<string> {
    const perms = this.permissionsOf(ctx);
    const shown = (name: string): boolean => {
      if (name.includes('.')) return this.pathLevel(entry, name, levels, ctx) !== 'hidden';
      const relationField = [...entry.relations.entries()].find(([, relation]) => relation.propertyName === name)?.[0];
      return (levels.get(relationField ?? name) ?? 'hidden') !== 'hidden';
    };
    const visible = new Set<string>();
    for (const [key, column] of entry.computed) {
      const children = column.deps.children.every(({ entity, fields }) => {
        const child = this.registry.forEntity(entity, entry.dataSource);
        if (!child) return true;
        if (!perms.canOn(child.schema.name, 'view')) return false;
        const childLevels = this.levels(child, ctx);
        return fields.every((field) => (childLevels.get(field) ?? 'hidden') !== 'hidden');
      });
      if (children && column.deps.own.every(shown)) visible.add(key);
    }
    return visible;
  }

  /** A path (`category.name`) is shown only when its relation field is, and the user may see the column where it lives. */
  private pathLevel(entry: RegisteredResource, path: string, levels: Map<string, FieldLevel>, ctx: AdminContext): FieldLevel {
    const [head, ...rest] = path.split('.');
    const relationField = [...entry.relations.entries()].find(([, relation]) => relation.propertyName === head)?.[0];
    const base = relationField ? levels.get(relationField) : levels.get(head!);
    if (!base || base === 'hidden') return 'hidden';
    const relation = relationField ? entry.relations.get(relationField) : undefined;
    const targetMetadata = relation?.inverseEntityMetadata;
    const target = targetMetadata ? this.registry.forEntity(targetMetadata.target, entry.dataSource) : undefined;
    if (!target || rest.length === 0) return 'view';
    if (!this.permissionsOf(ctx).canOn(target.schema.name, 'view')) return 'hidden';
    const targetLevels = this.levels(target, ctx);
    const nextName = rest.join('.');
    const level = targetLevels.get(nextName) ?? targetLevels.get(rest[0]!) ?? (rest.length > 1 ? this.pathLevel(target, nextName, targetLevels, ctx) : 'view');
    return level === 'hidden' ? 'hidden' : 'view';
  }

  /** The schema as this user may see and use it (spec §6.5): anti-oracle allow-lists, forms, permissions. */
  view(entry: RegisteredResource, schema: ResourceSchema, ctx: AdminContext): ResourceView {
    const perms = this.permissionsOf(ctx);
    const levels = this.levels(entry, ctx);
    const computed = this.computedVisible(entry, ctx, levels);
    const visible = (name: string) => (entry.computed.has(name) ? computed.has(name) : RANK[levels.get(name) ?? 'hidden'] >= 1);
    const editable = (name: string) => (levels.get(name) ?? 'hidden') === 'edit';
    const r = schema.name;
    const permissions = {
      create: schema.creatable && perms.canOn(r, 'create'),
      update: !schema.readonly && perms.canOn(r, 'update'),
      delete: !schema.readonly && perms.canOn(r, 'delete'),
      purge: !schema.readonly && perms.canOn(r, 'purge'),
    };
    const create = permissions.create ? schema.form.create.filter(editable) : [];
    const update = permissions.update ? schema.form.update.filter(editable) : [];
    // Fields of the forms this user cannot edit are shown as values instead, unless no column holds them (a create-only
    // DTO property the host's create() uses): an edit form would only show an empty lock for those.
    const stored = new Set(schema.fields.filter((field) => field.persisted !== false).map((field) => field.name));
    const formOnly = [...schema.form.update, ...schema.form.create].filter((name) => stored.has(name));
    const shownReadonly = [...new Set([...schema.form.readonly, ...formOnly])].filter((name) => visible(name) && !update.includes(name));
    const keep = (names: string[], test: (name: string) => boolean) => names.filter(test);
    const constraints = <V,>(map: Record<string, V>, allowed: string[]): Record<string, V> => Object.fromEntries(Object.entries(map).filter(([name]) => allowed.includes(name.split('.')[0]!)));
    const mobile = schema.list.mobile;
    const defaultVisible = visible(schema.list.defaultSort.field);
    const cut: ResourceSchema = {
      ...schema,
      creatable: permissions.create,
      permissions,
      fields: schema.fields.filter((field) => visible(field.name)),
      related: schema.related.filter((related) => perms.canOn(related.resource, 'view')),
      actions: schema.actions.filter((action) => this.canRunAction(entry, action, ctx)),
      list: {
        ...schema.list,
        columns: keep(schema.list.columns, visible),
        sortable: keep(schema.list.sortable, visible),
        // Sorting by a hidden field would reveal its order.
        defaultSort: defaultVisible ? schema.list.defaultSort : { field: schema.primaryKeys[0]!, direction: 'desc' },
        filters: schema.list.filters.filter((filter) => visible(filter.field)),
        search: keep(schema.list.search, visible),
        editable: permissions.update ? keep(schema.list.editable, editable) : [],
        ...(schema.list.computed
          ? {
              computed: Object.fromEntries(
                Object.entries(schema.list.computed)
                  .filter(([key]) => computed.has(key))
                  // A toggle writes its field: only for whoever may edit it.
                  .map(([key, column]) => [key, column.toggle && !(permissions.update && editable(column.toggle.field)) ? { ...column, toggle: undefined } : column]),
              ),
            }
          : {}),
        ...(mobile
          ? {
              mobile: {
                ...(mobile.title && visible(mobile.title) ? { title: mobile.title } : {}),
                ...(mobile.subtitle && visible(mobile.subtitle) ? { subtitle: mobile.subtitle } : {}),
                ...(mobile.badge && visible(mobile.badge) ? { badge: mobile.badge } : {}),
                meta: mobile.meta.filter(visible),
              },
            }
          : {}),
      },
      form: {
        ...schema.form,
        create,
        update,
        requiredOnCreate: schema.form.requiredOnCreate.filter((name) => create.includes(name)),
        readonly: [...new Set(shownReadonly)],
        constraints: { create: constraints(schema.form.constraints.create, create), update: constraints(schema.form.constraints.update, update) },
        ...(schema.form.layout ? { layout: this.cutLayout(schema.form.layout, visible, ctx) } : {}),
      },
    };
    // A tab filtering on a field this user cannot see would reveal it through its count.
    if (cut.list.tabs) cut.list.tabs = visibleTabs(cut);
    return { schema: cut, levels };
  }

  /**
   * Whether the user may see an inline at all (its schema, its rows, its changes): they may view the child resource
   * AND see its link field. Rows listed under a parent reveal their link's value, so a link hidden (or restricted and
   * not granted) makes the inline as absent as a child they cannot view.
   */
  canSeeInline(child: RegisteredResource, link: string, ctx: AdminContext): boolean {
    if (!this.permissionsOf(ctx).canOn(child.schema.name, 'view')) return false;
    return (this.levels(child, ctx).get(link) ?? 'hidden') !== 'hidden';
  }

  /**
   * The layout as this user sees it: sections keep their visible fields; an inline stays only when the user may see it
   * (`canSeeInline`), with the child's fields they may see and its `order` only when they may see that field (the
   * reader then sorts by key too); a tab left without sections by that goes too.
   */
  private cutLayout(layout: FormLayoutNode[], visible: (name: string) => boolean, ctx: AdminContext): FormLayoutNode[] {
    const cut = (node: FormLayoutSection | FormLayoutInline): FormLayoutSection | FormLayoutInline | undefined => {
      if (!('inline' in node)) return { ...node, fields: node.fields.filter(visible) };
      const child = this.registry.find(node.inline);
      if (!child || !this.canSeeInline(child, node.link, ctx)) return undefined;
      const levels = this.levels(child, ctx);
      const { order, ...rest } = node;
      // Rows sorted by a field the user cannot see would reveal its values: such an inline goes by key, unordered.
      const ordered = order !== undefined && RANK[levels.get(order) ?? 'hidden'] >= 1;
      return { ...rest, ...(ordered ? { order } : {}), fields: node.fields.filter((name) => RANK[levels.get(name) ?? 'hidden'] >= 1) };
    };
    const out: FormLayoutNode[] = [];
    for (const node of layout) {
      if ('tab' in node) {
        const sections = node.sections.map(cut).filter((section) => section !== undefined);
        if (sections.length > 0 || node.sections.length === 0) out.push({ ...node, sections });
      } else {
        const section = cut(node);
        if (section) out.push(section);
      }
    }
    return out;
  }

  /** Writes naming hidden or read-only fields are refused with their names, before anything else (spec §6.5). */
  checkWriteFields(entry: RegisteredResource, body: unknown, allowed: string[], ctx: AdminContext): void {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return;
    if (this.permissionsOf(ctx).superuser) return;
    const levels = this.levels(entry, ctx);
    const forbidden: Record<string, string[]> = {};
    for (const key of Object.keys(body)) {
      const level = levels.get(key);
      // Not a field at all, or one the form does not offer: validation answers as usual.
      if (level === undefined || level === 'edit' || !allowed.includes(key)) continue;
      forbidden[key] = [level === 'hidden' ? 'is not available' : 'is read-only for you'];
    }
    if (Object.keys(forbidden).length > 0) throw new AdminForbiddenFieldsError(forbidden);
  }

  /** Whether a query for `operation` needs restricting at all. */
  scoped(entry: RegisteredResource, operation: ScopedOperation, ctx: AdminContext | undefined): boolean {
    if (!ctx?.permissions) return false;
    return ctx.permissions.scopes(entry.schema.name, operation) !== 'all' || this.globalScopes(entry, ctx.permissions).length > 0;
  }

  /** Adds the user's row scopes for `operation` (ORed) and the global scopes (ANDed) to `qb`. */
  applyScopes(qb: SelectQueryBuilder<any>, entry: RegisteredResource, operation: ScopedOperation, ctx: AdminContext | undefined): SelectQueryBuilder<any> {
    const perms = ctx?.permissions;
    if (!perms || !ctx) return qb;
    const alias = qb.alias;
    const set = perms.scopes(entry.schema.name, operation);
    if (set !== 'all') {
      if (set.length === 0) qb.andWhere('1 = 0');
      else {
        qb.andWhere(
          new Brackets((or) => {
            set.forEach((name, index) => {
              const brackets = new Brackets((inner) => this.condition(inner, alias, entry, this.callScope(entry, name, ctx), `scope "${name}"`));
              if (index === 0) or.where(brackets);
              else or.orWhere(brackets);
            });
          }),
        );
      }
    }
    for (const scope of this.globalScopes(entry, perms)) {
      qb.andWhere(new Brackets((inner) => this.condition(inner, alias, entry, scope.where(ctx, { name: entry.schema.name }), `global scope "${scope.name}"`)));
    }
    return qb;
  }

  /** Names of the global scopes that restrict this resource for these permissions. */
  globalScopeNames(entry: RegisteredResource, perms: EffectivePermissions): string[] {
    return this.globalScopes(entry, perms).map((scope) => scope.name);
  }

  private globalScopes(entry: RegisteredResource, perms: EffectivePermissions): GlobalScope[] {
    return this.options.globalScopes.filter(
      (scope) => !(scope.exemptSuperusers && perms.superuser) && (scope.appliesTo ? scope.appliesTo({ name: entry.schema.name, entity: entry.entity, metadata: entry.metadata }) : true),
    );
  }

  private callScope(entry: RegisteredResource, name: string, ctx: AdminContext): ScopeCondition {
    const key = getScopes(entry.resource.constructor)[name]!;
    return (entry.resource as unknown as Record<string | symbol, (ctx: AdminContext) => ScopeCondition>)[key]!.call(entry.resource, ctx);
  }

  /** A scope's result as SQL: a column map (array = IN, null = IS NULL, undefined = no rows) or a callback. */
  private condition(where: WhereExpressionBuilder, alias: string, entry: RegisteredResource, condition: ScopeCondition, what: string): void {
    if (typeof condition === 'function') {
      condition(where, alias);
      return;
    }
    if (typeof condition !== 'object' || condition === null) throw new Error(`${entry.className}: ${what} must return a column map or a function`);
    const entries = Object.entries(condition);
    if (entries.length === 0) {
      where.where('1 = 1');
      return;
    }
    entries.forEach(([key, value], index) => {
      if (!entry.metadata.findColumnWithPropertyName(key)) throw new Error(`${entry.className}: ${what} names "${key}", which is not a column`);
      const param = `nmaScope${++this.parameter}`;
      const add = (sql: string, params?: Record<string, unknown>) => (index === 0 ? where.where(sql, params) : where.andWhere(sql, params));
      // undefined (a missing attribute) matches nothing: never "no restriction".
      if (value === undefined) add('1 = 0');
      else if (value === null) add(`${alias}.${key} IS NULL`);
      else if (Array.isArray(value)) add(value.length === 0 ? '1 = 0' : `${alias}.${key} IN (:...${param})`, value.length === 0 ? undefined : { [param]: value });
      else add(`${alias}.${key} = :${param}`, { [param]: value });
    });
  }

  /** The `_id`s among `ids` that `operation`'s scopes allow (all of them when nothing restricts it). */
  async allowedIds(entry: RegisteredResource, ids: RecordId[], operation: ScopedOperation, ctx: AdminContext, withDeleted = false): Promise<Set<string>> {
    const keys = entry.schema.primaryKeys;
    const all = new Set(ids.map((id) => recordIdOf(typeof id === 'object' ? id : { [keys[0]!]: id }, keys)));
    if (ids.length === 0 || !this.scoped(entry, operation, ctx)) return all;
    const manager: EntityManager = ctx.manager ?? entry.dataSource.manager;
    const qb = manager.getRepository(entry.metadata.target).createQueryBuilder('nma_scope').whereInIds(ids);
    if (withDeleted) qb.withDeleted();
    this.applyScopes(qb, entry, operation, ctx);
    const rows = await qb.select(keys.map((key) => `nma_scope.${key}`)).getMany();
    return new Set(rows.map((row) => recordIdOf(row, keys)));
  }

  /** 404 for a record outside the user's scope for `operation` (existence is not revealed, spec §6.5). */
  async requireInScope(entry: RegisteredResource, id: RecordId, rawId: string, operation: ScopedOperation, ctx: AdminContext, withDeleted = false): Promise<void> {
    if (!this.scoped(entry, operation, ctx)) return;
    if ((await this.allowedIds(entry, [id], operation, ctx, withDeleted)).size === 0) throw new AdminNotFoundError(`${entry.schema.label} "${rawId}" not found`);
  }

  /** `@AdminCan` rules for one record (`operation`: update, delete or a record action's name): all must agree; a rule that throws says no. */
  recordRule(entry: RegisteredResource, operation: RecordOperation | (string & {}), entity: object, ctx: AdminContext): boolean {
    const methods = entry.resource as unknown as Record<string | symbol, (record: object, ctx: AdminContext) => unknown>;
    for (const key of getCanRules(entry.resource.constructor, operation)) {
      try {
        if (methods[key]!.call(entry.resource, entity, ctx) !== true) return false;
      } catch (error) {
        this.warnOnce(`${entry.className}.${String(key)} (@AdminCan("${operation}")) threw: ${error instanceof Error ? error.message : String(error)}; the answer is no`);
        return false;
      }
    }
    return true;
  }

  /** 403 when `@AdminCan` says no for this record. */
  requireRecordRule(entry: RegisteredResource, operation: RecordOperation, entity: object, ctx: AdminContext): void {
    if (!this.recordRule(entry, operation, entity, ctx)) throw new AdminForbiddenError(`You may not ${operation} this ${entry.schema.label} record`);
  }

  /**
   * `_perm` of each record: permission, scope and `@AdminCan` together. `actions` (on resources with record actions)
   * names the ones the user may run on that record: offered to them (`canRunAction`), the record within their update
   * scopes, and the action's own `@AdminCan` rules agreeing. Skipped (undefined) for superusers on a resource without
   * any `@AdminCan` rule: nothing narrows what the schema says.
   */
  async recordPermissions(entry: RegisteredResource, entities: object[], ctx: AdminContext): Promise<Map<string, RecordPermissions> | undefined> {
    const perms = this.permissionsOf(ctx);
    const target = entry.resource.constructor;
    const recordActions = [...entry.actions.values()].filter((action) => action.target === 'record');
    const hasRules = ['update', 'delete', ...recordActions.map((action) => action.name)].some((name) => getCanRules(target, name).length > 0);
    if (perms.superuser && !hasRules) return undefined;
    const keys = entry.schema.primaryKeys;
    const ids = entities.map((entity) => (keys.length === 1 ? (entity as Record<string, unknown>)[keys[0]!] : Object.fromEntries(keys.map((key) => [key, (entity as Record<string, unknown>)[key]])))) as RecordId[];
    const result = new Map<string, RecordPermissions>();
    const allowed: Record<RecordOperation, Set<string> | undefined> = { update: undefined, delete: undefined };
    for (const operation of ['update', 'delete'] as const) {
      if (perms.canOn(entry.schema.name, operation)) allowed[operation] = await this.allowedIds(entry, ids, operation, ctx);
    }
    const offered = recordActions.filter((action) => this.canRunAction(entry, action, ctx));
    for (const entity of entities) {
      const id = recordIdOf(entity, keys);
      const updatable = allowed.update?.has(id) === true;
      result.set(id, {
        update: updatable && this.recordRule(entry, 'update', entity, ctx),
        delete: allowed.delete?.has(id) === true && this.recordRule(entry, 'delete', entity, ctx),
        // An action has its own rules: a shipped order may be closed to edits and still be cancellable.
        ...(recordActions.length > 0 ? { actions: updatable ? offered.filter((action) => this.recordRule(entry, action.name, entity, ctx)).map((action) => action.name) : [] } : {}),
      });
    }
    return result;
  }

  /** Relation titles of a resource the user cannot view (or whose title column is hidden) become `#id`. */
  maskReferences(entry: RegisteredResource, record: AdminRecord, fields: FieldSchema[], ctx: AdminContext): void {
    const perms = this.permissionsOf(ctx);
    if (perms.superuser) return;
    for (const field of fields) {
      if (field.type !== 'relation') continue;
      const relation = entry.relations.get(field.name);
      const target = relation ? this.registry.forEntity(relation.inverseEntityMetadata.target, entry.dataSource) : undefined;
      if (!target || this.titleVisible(target, ctx)) continue;
      const mask = (ref: unknown) => (ref && typeof ref === 'object' && 'id' in ref ? { ...ref, title: `#${String((ref as { id: unknown }).id)}` } : ref);
      const value = record[field.name];
      record[field.name] = Array.isArray(value) ? value.map(mask) : mask(value);
    }
  }

  /**
   * Related records outside the user's view scopes in their own resource (another tenant's team) are masked: the
   * title becomes `#id`, and paths through that relation (`team.name`) become null.
   */
  async maskOutOfScope(entry: RegisteredResource, records: AdminRecord[], fields: FieldSchema[], ctx: AdminContext): Promise<void> {
    for (const field of fields) {
      if (field.type !== 'relation') continue;
      const relation = entry.relations.get(field.name);
      const target = relation ? this.registry.forEntity(relation.inverseEntityMetadata.target, entry.dataSource) : undefined;
      if (!relation || !target || !this.scoped(target, 'view', ctx)) continue;
      const key = target.schema.primaryKeys[0]!;
      const refsOf = (value: unknown): Array<{ id: unknown }> =>
        (Array.isArray(value) ? value : value ? [value] : []).filter((ref): ref is { id: unknown } => typeof ref === 'object' && ref !== null && 'id' in ref);
      const ids = [...new Set(records.flatMap((record) => refsOf(record[field.name]).map((ref) => ref.id)))] as RecordId[];
      if (ids.length === 0) continue;
      const allowed = await this.allowedIds(target, ids, 'view', ctx);
      const inScope = (id: unknown) => allowed.has(recordIdOf({ [key]: id }, [key]));
      const paths = fields.filter((candidate) => candidate.name.startsWith(`${relation.propertyName}.`));
      for (const record of records) {
        const value = record[field.name];
        const mask = (ref: { id: unknown }) => (inScope(ref.id) ? ref : { ...ref, title: `#${String(ref.id)}` });
        if (Array.isArray(value)) record[field.name] = refsOf(value).map(mask);
        else if (value && typeof value === 'object' && 'id' in value) {
          record[field.name] = mask(value as { id: unknown });
          if (!inScope((value as { id: unknown }).id)) for (const path of paths) if (path.name in record) record[path.name] = null;
        }
      }
    }
  }

  /** Whether the user may see a record's title in this resource. */
  titleVisible(entry: RegisteredResource, ctx: AdminContext): boolean {
    const perms = this.permissionsOf(ctx);
    if (perms.superuser) return true;
    if (!perms.canOn(entry.schema.name, 'view')) return false;
    const column = entry.title.column;
    return !column || (this.levels(entry, ctx).get(column) ?? 'view') !== 'hidden';
  }

  private warnOnce(message: string): void {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    this.logger.warn(message);
  }
}

/** Fields that are not paths. */
export function topLevelFields(schema: ResourceSchema): FieldSchema[] {
  return schema.fields.filter((field) => !field.name.includes('.'));
}


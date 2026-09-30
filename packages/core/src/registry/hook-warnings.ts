import { getHooks } from '../decorators/hooks.js';
import { AdminResourceBase } from '../resource/admin-resource-base.js';

const base = AdminResourceBase.prototype;

/** Hooks run in the base class's default writes; say so when a class overrides a write that has hooks (an override may still call super). */
export function hookWarnings(resource: AdminResourceBase<any>, className: string): string[] {
  const warnings: string[] = [];
  const target = resource.constructor;
  const hasSaveHooks = getHooks(target, 'beforeSave').length + getHooks(target, 'afterSave').length > 0;
  for (const method of ['create', 'update'] as const) {
    if (hasSaveHooks && resource[method] !== base[method]) {
      warnings.push(
        `${className}: ${method}() is overridden: @BeforeSave/@AfterSave hooks run only if your ${method}() override calls super.${method}() or this.runHooks('beforeSave' | 'afterSave', …)`,
      );
    }
  }
  if (getHooks(target, 'beforeDelete').length > 0 && resource.delete !== base.delete) {
    warnings.push(`${className}: delete() is overridden: @BeforeDelete hooks run only if your delete() override calls super.delete() or this.runHooks('beforeDelete', …)`);
  }
  return warnings;
}

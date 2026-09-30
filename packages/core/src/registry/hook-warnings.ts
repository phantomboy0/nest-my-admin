import { getHooks } from '../decorators/hooks.js';
import { AdminResourceBase } from '../resource/admin-resource-base.js';

const base = AdminResourceBase.prototype;

/** Hooks only run in the base class's default writes; say so when a class overrides a write that has hooks. */
export function hookWarnings(resource: AdminResourceBase<any>, className: string): string[] {
  const warnings: string[] = [];
  const target = resource.constructor;
  const hasSaveHooks = getHooks(target, 'beforeSave').length + getHooks(target, 'afterSave').length > 0;
  for (const method of ['create', 'update'] as const) {
    if (hasSaveHooks && resource[method] !== base[method]) {
      warnings.push(
        `${className}: @BeforeSave/@AfterSave hooks do not run because ${method}() is overridden; call this.runHooks('beforeSave' | 'afterSave', …) in your override`,
      );
    }
  }
  if (getHooks(target, 'beforeDelete').length > 0 && resource.delete !== base.delete) {
    warnings.push(`${className}: @BeforeDelete hooks do not run because delete() is overridden; call this.runHooks('beforeDelete', …) in your override`);
  }
  return warnings;
}

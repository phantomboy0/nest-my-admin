import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { AfterSave, BeforeDelete, BeforeSave } from '../decorators/hooks.js';
import { AdminResourceBase } from '../resource/admin-resource-base.js';
import { hookWarnings } from './hook-warnings.js';

describe('hookWarnings', () => {
  test('warns when a write with hooks is overridden', () => {
    class OverridingAdmin extends AdminResourceBase {
      @BeforeSave() normalise() {}
      @BeforeDelete() guard() {}
      async create(dto: object) {
        return dto;
      }
      async delete() {}
    }
    expect(hookWarnings(new OverridingAdmin(), 'OverridingAdmin')).toEqual([
      "OverridingAdmin: create() is overridden: @BeforeSave/@AfterSave hooks run only if your create() override calls super.create() or this.runHooks('beforeSave' | 'afterSave', …)",
      "OverridingAdmin: delete() is overridden: @BeforeDelete hooks run only if your delete() override calls super.delete() or this.runHooks('beforeDelete', …)",
    ]);
  });

  test('stays quiet when hooks and overrides do not meet', () => {
    class HooksOnly extends AdminResourceBase {
      @AfterSave() log() {}
    }
    class OverrideOnly extends AdminResourceBase {
      async update(_id: string | number, dto: object) {
        return dto;
      }
    }
    expect(hookWarnings(new HooksOnly(), 'HooksOnly')).toEqual([]);
    expect(hookWarnings(new OverrideOnly(), 'OverrideOnly')).toEqual([]);
  });
});

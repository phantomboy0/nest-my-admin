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
      "OverridingAdmin: @BeforeSave/@AfterSave hooks do not run because create() is overridden; call this.runHooks('beforeSave' | 'afterSave', …) in your override",
      "OverridingAdmin: @BeforeDelete hooks do not run because delete() is overridden; call this.runHooks('beforeDelete', …) in your override",
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

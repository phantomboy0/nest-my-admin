import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { AfterSave, BeforeDelete, BeforeSave, getHooks } from './hooks.js';

class Parent {
  @BeforeSave() parentBefore() {}
  @BeforeDelete() guard() {}
}

class Child extends Parent {
  @BeforeSave() childBefore() {}
  @AfterSave() childAfter() {}
}

describe('hook decorators', () => {
  test('collect hooks in order, parent first, without leaking into the parent', () => {
    expect(getHooks(Child, 'beforeSave')).toEqual(['parentBefore', 'childBefore']);
    expect(getHooks(Child, 'afterSave')).toEqual(['childAfter']);
    expect(getHooks(Child, 'beforeDelete')).toEqual(['guard']);
    expect(getHooks(Parent, 'beforeSave')).toEqual(['parentBefore']);
    expect(getHooks(class Plain {}, 'beforeSave')).toEqual([]);
  });
});

import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { AdminResourceBase } from '../resource/admin-resource-base.js';
import { AdminGroup, getAdminGroupOptions } from './admin-group.js';
import { AdminResource, getAdminResourceDefinition } from './admin-resource.js';

class Thing {}

@AdminResource(Thing, { icon: 'box' })
class ThingAdmin extends AdminResourceBase {}

describe('@AdminResource', () => {
  test('stores the definition and makes the class injectable', () => {
    expect(getAdminResourceDefinition(ThingAdmin)).toEqual({ entity: Thing, icon: 'box' });
    expect(Reflect.getMetadata('__injectable__', ThingAdmin)).toBe(true);
  });

  test('is not inherited by subclasses (they would register twice)', () => {
    class SpecialThingAdmin extends ThingAdmin {}
    expect(getAdminResourceDefinition(SpecialThingAdmin)).toBeUndefined();
  });
});

describe('@AdminGroup', () => {
  test('stores options on a module class', () => {
    @AdminGroup({ label: 'Sales', icon: 'cart', order: 5 })
    class SalesModule {}
    expect(getAdminGroupOptions(SalesModule)).toEqual({ label: 'Sales', icon: 'cart', order: 5 });
    expect(getAdminGroupOptions(class Plain {})).toBeUndefined();
  });
});

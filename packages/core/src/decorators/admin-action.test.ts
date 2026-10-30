import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { IsString } from 'class-validator';
import { AdminAction, getActions, resolveActions, toActionSchema } from './admin-action.js';
import { AdminField } from './admin-field.js';
import { AdminCan } from './admin-scope.js';
import { resolveText, type LocalizedText } from '../i18n/localized-text.js';

/** Texts in `locale`, the default being English. */
const loc = (locale: string) => (value: LocalizedText) => resolveText(value, locale, 'en');

class NoteDto {
  @AdminField({ label: { en: 'Note', fa: 'یادداشت' } })
  @IsString()
  note: string;
}

class BaseAdmin {
  @AdminAction({ label: { en: 'Approve', fa: 'تایید' }, bulk: true, confirm: true, input: NoteDto, icon: 'check' })
  approve() {}
}
class ChildAdmin extends BaseAdmin {
  @AdminAction({ target: 'resource', variant: 'destructive' })
  wipeAll() {}
  @AdminCan('approve') canApprove() {
    return true;
  }
}

const RESERVED = ['constructor', 'create', 'update', 'delete', 'restore', 'purge', 'findOne', 'findMany', 'query', 'links'];
const fail = (message: string): never => {
  throw new Error(message);
};
const resolve = (target: Function) => resolveActions(target, RESERVED, fail);

describe('@AdminAction', () => {
  test('the method name is the action name; subclasses inherit and add', () => {
    expect([...getActions(BaseAdmin).keys()]).toEqual(['approve']);
    expect([...getActions(ChildAdmin).keys()]).toEqual(['approve', 'wipeAll']);
    expect(getActions(ChildAdmin).get('wipeAll')).toEqual({ name: 'wipeAll', target: 'resource', variant: 'destructive' });
    expect(getActions(class Plain {}).size).toBe(0);
  });

  test('must decorate a named method', () => {
    const key = Symbol('hidden');
    expect(() => {
      class SymbolAdmin {
        @AdminAction() [key]() {}
      }
      return SymbolAdmin;
    }).toThrow('@AdminAction must decorate a method with a string name');
  });
});

describe('resolveActions', () => {
  test('fills the defaults and builds the input form', () => {
    const actions = resolve(ChildAdmin);
    const approve = actions.get('approve')!;
    expect({ ...approve, form: undefined }).toEqual({
      name: 'approve', label: { en: 'Approve', fa: 'تایید' }, primary: false, target: 'record', bulk: true, atomic: false, confirm: true, variant: 'default', icon: 'check', input: NoteDto, form: undefined,
    });
    expect(approve.form!.required).toEqual(['note']);
    expect(actions.get('wipeAll')).toEqual({ name: 'wipeAll', label: 'Wipe all', primary: false, target: 'resource', bulk: false, atomic: false, variant: 'destructive' });
  });

  test('toActionSchema resolves the texts for one language', () => {
    const approve = resolve(ChildAdmin).get('approve')!;
    expect(toActionSchema(approve, loc('fa'))).toMatchObject({ name: 'approve', label: 'تایید', confirm: true, input: { fields: [{ name: 'note', label: 'یادداشت' }], required: ['note'] } });
    const asked = { ...approve, confirm: { en: 'Sure?', fa: 'مطمئنید؟' } };
    expect(toActionSchema(asked, loc('en')).confirm).toBe('Sure?');
    const { confirm: _confirm, ...quiet } = approve;
    expect('confirm' in toActionSchema(quiet, loc('en'))).toBe(false);
    expect('input' in toActionSchema(resolve(ChildAdmin).get('wipeAll')!, loc('en'))).toBe(false);
  });

  const bad = (options: Parameters<typeof AdminAction>[0], method = 'run') => {
    class BadAdmin {}
    Object.defineProperty(BadAdmin.prototype, method, { value() {}, writable: true, configurable: true });
    AdminAction(options)(BadAdmin.prototype, method, Object.getOwnPropertyDescriptor(BadAdmin.prototype, method)!);
    return () => resolve(BadAdmin);
  };

  test('names: no built-in operation, no base-class method, a plain word', () => {
    for (const name of ['create', 'update', 'delete', 'restore', 'purge']) expect(bad({}, name)).toThrow(`@AdminAction "${name}" collides with the built-in ${name}`);
    expect(bad({}, 'view')).toThrow('@AdminAction "view" collides with the built-in view');
    expect(bad({}, 'findOne')).toThrow('@AdminAction "findOne" overrides AdminResourceBase.findOne()');
    expect(bad({}, 'ship-now')).toThrow('@AdminAction "ship-now": the method name must be a word (letters, digits, _)');
    expect(bad({}, 'field')).toThrow('@AdminAction "field"');
  });

  test('options that contradict each other or are not known', () => {
    expect(bad({ target: 'rows' as never })).toThrow('@AdminAction "run": target must be "record" or "resource"');
    expect(bad({ variant: 'danger' as never })).toThrow('@AdminAction "run": variant must be "default" or "destructive"');
    expect(bad({ target: 'resource', bulk: true })).toThrow('@AdminAction "run": `bulk` and `atomic` are for record actions');
    expect(bad({ atomic: true })).toThrow('@AdminAction "run": `atomic` needs `bulk: true`');
    expect(bad({ confirm: 3 as never })).toThrow('@AdminAction "run": confirm must be true, false or a text');
    expect(bad({ input: {} as never })).toThrow('@AdminAction "run": input must be a DTO class');
  });

  test('input DTOs cannot take files or rich text', () => {
    for (const widget of ['file', 'image', 'richtext'] as const) {
      class UploadDto {
        @AdminField({ widget }) @IsString() body: string;
      }
      expect(bad({ input: UploadDto })).toThrow(`@AdminAction "run": input field "body" uses the "${widget}" widget; action inputs cannot take files or rich text`);
    }
    class EmptyDto {}
    expect(bad({ input: EmptyDto })).toThrow('@AdminAction "run": input EmptyDto: no property has a class-validator decorator');
  });

  test('@AdminCan names update, delete or a record action', () => {
    class TypoAdmin extends BaseAdmin {
      @AdminCan('aprove') no() {
        return false;
      }
    }
    expect(() => resolve(TypoAdmin)).toThrow('@AdminCan("aprove") names no record action (did you mean "approve"?)');
    class ResourceRuleAdmin extends ChildAdmin {
      @AdminCan('wipeAll') no() {
        return false;
      }
    }
    expect(() => resolve(ResourceRuleAdmin)).toThrow('@AdminCan("wipeAll"): "wipeAll" runs on the resource, not on a record');
    class FineAdmin extends BaseAdmin {
      @AdminCan('update') a() {
        return true;
      }
      @AdminCan('delete') b() {
        return true;
      }
    }
    expect(() => resolve(FineAdmin)).not.toThrow();
  });
});

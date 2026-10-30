import { describe, expect, test } from 'bun:test';
import { IsString } from 'class-validator';
import { AdminResourceBase, type AdminContext, type AdminWriteContext } from '../src/index.js';
import { Widget } from './fixtures/widgets.js';

class WidgetDto {
  @IsString() name: string;
}

/** A resource with a number id and typed write methods. */
class TypedAdmin extends AdminResourceBase<Widget, number> {
  override async update(id: number, dto: WidgetDto, ctx: AdminWriteContext) {
    ctx.manager.getRepository(Widget);
    return super.update(id, dto, ctx);
  }
}

/** A 0.6-style override still compiles. */
class LooseAdmin extends AdminResourceBase<Widget> {
  override async create(dto: object, ctx: AdminContext) {
    return super.create(dto, ctx);
  }
}

class WrongIdAdmin extends AdminResourceBase<Widget, number> {
  // @ts-expect-error a resource with number ids does not take string ids
  override async delete(id: string, ctx: AdminWriteContext) {
    return super.delete(Number(id), ctx);
  }
}

describe('types (checked by `bun run typecheck`)', () => {
  test('resource classes with typed ids and write contexts compile', () => {
    expect([TypedAdmin, LooseAdmin, WrongIdAdmin].map((type) => type.name)).toEqual(['TypedAdmin', 'LooseAdmin', 'WrongIdAdmin']);
  });
});

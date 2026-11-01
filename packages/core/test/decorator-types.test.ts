import { describe, expect, test } from 'bun:test';
import { IsInt, IsString } from 'class-validator';
import {
  AdminAction,
  AdminCan,
  AdminPrint,
  AdminResource,
  AdminResourceBase,
  AdminSource,
  AdminSourceBase,
  AdminScope,
  AdminSettingsPage,
  AdminWidget,
  AfterSave,
  BeforeDelete,
  BeforeSave,
  html,
  type AdminContext,
  type ActionOutcome,
} from '../src/index.js';

/**
 * The decorators refuse methods and classes of the wrong shape at compile time: every `@ts-expect-error` below is
 * a line `bun run typecheck` must reject (an unused one fails the typecheck). The runtime checks in
 * contracts.test.ts cover plain JavaScript and `any`.
 */
class Note {
  id: number;
  title: string;
}
class ShipDto {
  @IsInt() boxes: number;
}
class OtherDto {
  @IsString() note: string;
}

class Typed extends AdminResourceBase<Note> {
  @AdminAction() async ok(_note: Note, _input: unknown, _ctx: AdminContext): Promise<ActionOutcome> {
    return { message: 'Done' };
  }
  @AdminAction() async silent() {}
  @AdminAction() sync() {
    return { message: { en: 'Done', fa: 'انجام شد' } };
  }
  // @ts-expect-error a typo in the outcome is not an ActionOutcome
  @AdminAction() async typo() {
    return { mesage: 'Done' };
  }
  // @ts-expect-error the record is not an outcome
  @AdminAction() async record(note: Note) {
    return note;
  }
  // @ts-expect-error a string is not an outcome
  @AdminAction() async text() {
    return 'Done';
  }
  @AdminAction({ input: ShipDto }) async ship(_note: Note, input: ShipDto) {
    return { message: String(input.boxes) };
  }
  // @ts-expect-error `input` is ShipDto but the method takes OtherDto
  @AdminAction({ input: ShipDto }) async mismatch(_note: Note, _input: OtherDto) {}
  @AdminAction({ target: 'resource', input: ShipDto }) async restock(input: ShipDto, _ctx: AdminContext) {
    return { message: String(input.boxes) };
  }
  // @ts-expect-error a resource action's first parameter is the input, not a record
  @AdminAction({ target: 'resource', input: ShipDto }) async restockWrong(_note: Note, _input: ShipDto) {}

  @AdminScope('own') own(ctx: AdminContext) {
    return { ownerId: ctx.user?.id };
  }
  // @ts-expect-error a scope answers at once, not a Promise
  @AdminScope('later') async later(ctx: AdminContext) {
    return { ownerId: ctx.user?.id };
  }

  @AdminCan('update') canEdit(note: Note) {
    return note.title !== '';
  }
  // @ts-expect-error a rule answers a boolean at once
  @AdminCan('delete') async canDelete() {
    return true;
  }
  // @ts-expect-error a rule answers a boolean, not a text
  @AdminCan('ok') canOk() {
    return 'yes';
  }

  @AdminPrint() invoice(notes: Note[]) {
    return html`<b>${notes[0]!.title}</b>`;
  }
  @AdminPrint() async later2(notes: Note[]) {
    return html`<b>${notes.length}</b>`;
  }
  // @ts-expect-error a plain string is not escaped: use html`…`
  @AdminPrint() plain(notes: Note[]) {
    return `<b>${notes[0]!.title}</b>`;
  }

  // @ts-expect-error the record is a Note, not an OtherDto
  @AdminAction() async wrongRecord(_record: OtherDto) {}
  // @ts-expect-error a rule's record is a Note
  @AdminCan('update') canWrong(record: OtherDto) {
    return record.note !== '';
  }
  // @ts-expect-error a print gets Notes
  @AdminPrint() wrongPrint(records: OtherDto[]) {
    return html`${records.length}`;
  }
  // @ts-expect-error a hook returns nothing
  @BeforeSave() async returning(dto: Partial<Note>) {
    return dto;
  }
  // @ts-expect-error an AfterSave hook gets the saved Note
  @AfterSave() afterWrong(_record: OtherDto) {}

  @BeforeSave() stamp(_dto: Partial<Note>, _ctx: AdminContext, _mode: 'create' | 'update') {}
  @AfterSave() async after(_note: Note) {}
  // @ts-expect-error a delete's mode is soft or hard, not create or update
  @BeforeDelete() guard(_note: Note, _ctx: AdminContext, _mode: 'create' | 'update') {}
}

@AdminWidget('fine', { type: 'stat', title: 'Fine' })
class FineWidget {
  async load() {
    return { value: '1' };
  }
}
// @ts-expect-error a stat's value is text
@AdminWidget('numeric', { type: 'stat', title: 'Numeric' })
class NumericWidget {
  async load() {
    return { value: 1 };
  }
}
// @ts-expect-error a widget needs load()
@AdminWidget('loadless', { type: 'stat', title: 'No load' })
class LoadlessWidget {}

class NoticeDto {
  @IsString() text: string;
}
@AdminSettingsPage('notice', { form: NoticeDto })
class NoticePage {
  load() {
    return { text: 'hi' };
  }
  save(_changes: Partial<NoticeDto>) {}
}
// @ts-expect-error a settings page needs save()
@AdminSettingsPage('saveless', { form: NoticeDto })
class SavelessPage {
  load() {
    return {};
  }
}

@AdminResource(Note)
class NoteAdmin extends AdminResourceBase<Note> {}
// @ts-expect-error a resource class extends AdminResourceBase
@AdminResource(Note)
class PlainAdmin {}
// @ts-expect-error the base's row is the resource's entity
@AdminResource(Note)
class OtherRowAdmin extends AdminResourceBase<OtherDto> {}
// @ts-expect-error a source class extends AdminSourceBase
@AdminSource(OtherDto)
class TableForSource extends AdminResourceBase<OtherDto> {}

describe('decorator types', () => {
  test('the classes above typecheck as annotated (bun run typecheck)', () => {
    expect([Typed, FineWidget, NumericWidget, LoadlessWidget, NoticePage, SavelessPage, NoteAdmin, PlainAdmin, OtherRowAdmin, TableForSource].length).toBe(10);
  });
});

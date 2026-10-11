import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { AdminField } from '../decorators/admin-field.js';
import { buildDtoForm, localizeDtoForm } from './dto-form.js';

class LineDto {
  @IsString() @Length(1, 10) sku: string;
  @IsOptional() @IsInt() @Min(1) qty?: number;
}

class RefundDto {
  @AdminField({ label: { en: 'Amount', fa: 'مبلغ' }, help: 'In rials' })
  @IsInt()
  @Min(1)
  @Max(1000)
  amount: number;

  @IsIn(['card', 'wallet'])
  method: string;

  @IsOptional() @IsString() @Length(0, 200) note?: string;

  @IsBoolean() notify: boolean = true;

  @ValidateIf((dto: RefundDto) => dto.method === 'card')
  @IsString()
  @Length(16, 16)
  card?: string;

  @ValidateNested({ each: true })
  @Type(() => LineDto)
  lines: LineDto[];

  /** No validator: not part of the form. */
  internal?: string;
}

describe('buildDtoForm', () => {
  const form = buildDtoForm(RefundDto);

  test('fields come from the DTO alone, in declaration order', () => {
    expect(form.fields.map((field) => [field.name, field.type])).toEqual([
      ['amount', 'number'], ['method', 'enum'], ['note', 'string'], ['notify', 'boolean'], ['card', 'string'], ['lines', 'object'],
    ]);
    expect(form.fields[0]).toEqual({ name: 'amount', label: 'Amount', type: 'number', nullable: false, primary: false, readonly: false, persisted: false, integer: true });
    expect(form.fields[1]!.enumValues).toEqual(['card', 'wallet']);
    expect(form.fields[5]).toMatchObject({ many: true, fields: [{ name: 'sku', type: 'string' }, { name: 'qty', type: 'number' }] });
  });

  test('constraints and required, as the browser checks them', () => {
    expect(form.constraints).toEqual({
      amount: { integer: true, min: 1, max: 1000, required: true },
      method: { oneOf: ['card', 'wallet'], required: true },
      note: { maxLength: 200 },
      notify: {}, // a class initializer fills it
      card: {}, // @ValidateIf: the server may skip every rule
      lines: { required: true },
      'lines.*.sku': { minLength: 1, maxLength: 10, required: true },
      'lines.*.qty': { integer: true, min: 1 },
    });
    expect(form.required).toEqual(['amount', 'method', 'lines']);
  });

  test('keeps texts in every language; localizeDtoForm resolves them per request', () => {
    expect(form.config.get('amount')).toEqual({ label: { en: 'Amount', fa: 'مبلغ' }, help: 'In rials' });
    const fa = localizeDtoForm(form, 'fa', 'en');
    expect(fa.fields[0]).toMatchObject({ name: 'amount', label: 'مبلغ', help: 'In rials' });
    expect(localizeDtoForm(form, 'de', 'en').fields[0]!.label).toBe('Amount');
    expect(Object.keys(fa)).toEqual(['fields', 'constraints', 'required']);
    expect(fa.constraints).toEqual(form.constraints);
    expect(fa.required).toEqual(form.required);
  });

  test('a field-config map wins over @AdminField, option by option', () => {
    const configured = buildDtoForm(RefundDto, {
      amount: { label: 'Sum', widget: 'money' },
      method: { widget: 'radio', enumLabels: { card: { en: 'Card', fa: 'کارت' } } },
      card: { showIf: { method: 'card' } },
    });
    const en = localizeDtoForm(configured, 'en', 'en');
    expect(en.fields[0]).toMatchObject({ label: 'Sum', help: 'In rials', widget: 'money' });
    expect(en.fields[1]).toMatchObject({ widget: 'radio', enumLabels: { card: 'Card' } });
    expect(en.fields[4]!.showIf).toEqual({ method: 'card' });
  });

  test('configuration mistakes fail with the DTO named', () => {
    expect(() => buildDtoForm(RefundDto, { amont: { label: 'x' } })).toThrow('RefundDto: fields: unknown field "amont" (did you mean "amount"?)');
    expect(() => buildDtoForm(RefundDto, { note: { widget: 'switch' } })).toThrow('RefundDto: fields.note: the "switch" widget does not fit string fields');
    expect(() => buildDtoForm(RefundDto, { card: { showIf: { nope: 1 } } })).toThrow('fields.card.showIf: unknown field "nope"');
    class Empty {
      plain?: string;
    }
    expect(() => buildDtoForm(Empty)).toThrow('Empty: no property has a class-validator decorator, so the form would be empty');
    class Reserved {
      @IsString() _id: string;
    }
    expect(() => buildDtoForm(Reserved)).toThrow('Reserved: property "_id": names starting with "_" are reserved for the admin');
    const messages: string[] = [];
    expect(() =>
      buildDtoForm(Empty, undefined, (message) => {
        messages.push(message);
        throw new Error('custom');
      }),
    ).toThrow('custom');
    expect(messages).toEqual(['no property has a class-validator decorator, so the form would be empty']);
  });
});

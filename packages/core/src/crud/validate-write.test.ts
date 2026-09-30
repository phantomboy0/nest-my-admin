import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Min, ValidateNested } from 'class-validator';
import { AdminBadRequestError, AdminValidationError } from '../errors.js';
import { validateWrite } from './validate-write.js';

class ItemDto {
  @IsString() @Length(1, 20) name: string;
  @IsOptional() @IsInt() @Min(0) qty?: number;
}

class DefaultsDto {
  @IsString() name: string;
  @IsOptional() active: boolean = true;
}

class AddressDto {
  @IsString() city: string;
}

class PersonDto {
  @ValidateNested() @Type(() => AddressDto) address: AddressDto;
}

async function fieldErrors(promise: Promise<unknown>): Promise<Record<string, string[]>> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AdminValidationError) return error.fields ?? {};
    throw error;
  }
  throw new Error('expected an AdminValidationError');
}

describe('validateWrite', () => {
  test('returns a DTO instance for a valid body', async () => {
    const result = await validateWrite({ name: 'Bolt', qty: 3 }, { allowed: ['name', 'qty'], dto: ItemDto });
    expect(result).toBeInstanceOf(ItemDto);
    expect(result).toMatchObject({ name: 'Bolt', qty: 3 });
  });

  test('rejects bodies that are not JSON objects', async () => {
    for (const body of [null, [], 'text', 42, undefined]) {
      await expect(validateWrite(body, { allowed: ['name'] })).rejects.toBeInstanceOf(AdminBadRequestError);
    }
  });

  test('rejects keys that are not writable', async () => {
    expect(await fieldErrors(validateWrite({ name: 'a', id: 1, extra: true }, { allowed: ['name', 'qty'], dto: ItemDto }))).toEqual({
      id: ['is not a writable field'],
      extra: ['is not a writable field'],
    });
  });

  test('reports DTO violations per field', async () => {
    const errors = await fieldErrors(validateWrite({ name: '', qty: -1 }, { allowed: ['name', 'qty'], dto: ItemDto }));
    expect(Object.keys(errors).sort()).toEqual(['name', 'qty']);
  });

  test('partial mode validates only the keys that were sent', async () => {
    await expect(validateWrite({ qty: 3 }, { allowed: ['name', 'qty'], dto: ItemDto, partial: true })).resolves.toMatchObject({ qty: 3 });
    expect(Object.keys(await fieldErrors(validateWrite({ name: null }, { allowed: ['name', 'qty'], dto: ItemDto, partial: true })))).toEqual(['name']);
  });

  test('flattens nested DTO errors to dotted paths', async () => {
    const errors = await fieldErrors(validateWrite({ address: { city: 5 } }, { allowed: ['address'], dto: PersonDto }));
    expect(Object.keys(errors)).toEqual(['address.city']);
  });

  test('without a DTO returns a plain copy of the allowed keys', async () => {
    expect(await validateWrite({ name: 'x' }, { allowed: ['name'] })).toEqual({ name: 'x' });
  });

  test('only carries keys the client sent, not DTO initializer defaults', async () => {
    const result = await validateWrite({ name: 'x' }, { allowed: ['name', 'active'], dto: DefaultsDto, partial: true });
    expect(Object.keys(result)).toEqual(['name']);
  });
});

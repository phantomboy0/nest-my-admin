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

describe('file fields', () => {
  class MediaDto {
    @IsString() name: string;
    @IsString() logo: string;
    @IsOptional() @IsString({ each: true }) gallery?: string[];
  }
  const field = (name: string, many: boolean) => ({ name, type: many ? 'json' : 'string', file: { accept: ['*/*'], maxBytes: 10, many } }) as never;
  const rules = { allowed: ['name', 'logo', 'gallery'], dto: MediaDto, fields: [field('logo', false), field('gallery', true)] };
  const failure = (body: unknown, extra = {}) => validateWrite(body, { ...rules, ...extra }).then(() => undefined, (error: AdminValidationError) => error.fields);

  test('a sent file satisfies the DTO rule of its column and reaches the resource as sent', async () => {
    const dto = (await validateWrite({ name: 'A', logo: { token: 't1' }, gallery: [{ key: 'a/b.png' }, { token: 't2' }] }, rules)) as Record<string, unknown>;
    expect(dto).toBeInstanceOf(MediaDto);
    expect(dto.logo).toEqual({ token: 't1' });
    expect(dto.gallery).toEqual([{ key: 'a/b.png' }, { token: 't2' }]);
  });

  test('a missing or null file still answers to the DTO, and the rest is validated as usual', async () => {
    expect(await failure({ name: 'A' })).toEqual({ logo: ['logo must be a string'] });
    expect(await failure({ name: 'A', logo: null })).toEqual({ logo: ['logo must be a string'] });
    expect(await failure({ name: 5, logo: { token: 't1' } })).toEqual({ name: ['name must be a string'] });
    expect(await failure({ gallery: null }, { partial: true })).toBeUndefined();
  });

  test('other shapes are refused, with or without a DTO', async () => {
    for (const extra of [{}, { dto: undefined }]) {
      expect(await failure({ name: 'A', logo: 'a/b.png' }, extra)).toEqual({ logo: ['must be an uploaded file'] });
      expect(await failure({ name: 'A', logo: { token: 't', extra: 1 } }, extra)).toEqual({ logo: ['must be an uploaded file'] });
      expect(await failure({ name: 'A', logo: { token: 'x'.repeat(37) } }, extra)).toEqual({ logo: ['must be an uploaded file'] });
      expect(await failure({ name: 'A', logo: { token: 't' }, gallery: [{ key: '' }] }, extra)).toEqual({ gallery: ['must be a list of uploaded files'] });
      expect(await failure({ name: 'A', logo: { token: 't' }, gallery: Array.from({ length: 101 }, () => ({ token: 't' })) }, extra)).toEqual({ gallery: ['must be a list of uploaded files'] });
    }
  });
});

describe('rich text', () => {
  const body = { name: 'body', type: 'text', widget: 'richtext' } as never;
  const title = { name: 'title', type: 'string' } as never;
  const rules = { allowed: ['title', 'body'], fields: [title, body] };

  test('sent HTML goes through the sanitizer before it is returned', async () => {
    const dto = await validateWrite({ title: 'T', body: '<p>a</p><script>x</script>' }, { ...rules, sanitizeHtml: (html) => html.replace(/<script>.*<\/script>/, '') });
    expect(dto).toEqual({ title: 'T', body: '<p>a</p>' });
  });

  test('fails closed: a schema with a rich-text field and no sanitizer is a programming error, never stored raw', async () => {
    const raw = validateWrite({ title: 'T', body: '<script>x</script>' }, rules).then(
      () => 'stored',
      (error: unknown) => error,
    );
    const error = await raw;
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AdminValidationError);
    expect(error).not.toBeInstanceOf(AdminBadRequestError);
    expect((error as Error).message).toBe('nest-my-admin: validateWrite needs `sanitizeHtml` for the rich-text field "body"');
    // Also when the body leaves the field out or clears it: the caller is wrong either way.
    await expect(validateWrite({ title: 'T' }, rules)).rejects.toThrow('needs `sanitizeHtml`');
    await expect(validateWrite({ body: null }, rules)).rejects.toThrow('needs `sanitizeHtml`');
    // Schemas without rich text need none.
    expect(await validateWrite({ title: 'T' }, { allowed: ['title'], fields: [title] })).toEqual({ title: 'T' });
  });
});

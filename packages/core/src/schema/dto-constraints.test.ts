import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, IsUrl, IsUUID, Length, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { dtoConstraints } from './dto-constraints.js';

class SampleDto {
  @IsString() @Length(2, 40) name: string;
  @MinLength(3) @MaxLength(9) code: string;
  @IsInt() @Min(0) @Max(99) qty: number;
  @IsEmail() email: string;
  @IsOptional() @IsUrl() site?: string;
  @IsOptional() @IsUUID() ref?: string;
  @Matches(/^[a-z]+$/i, { message: 'letters only' }) slug: string;
  @IsIn(['draft', 'live']) status: string;
  @IsOptional() @IsString({ each: true }) tags?: string[];
}

describe('dtoConstraints', () => {
  test('compiles class-validator metadata', () => {
    expect(dtoConstraints(SampleDto)).toEqual({
      name: { required: true, minLength: 2, maxLength: 40 },
      code: { required: true, minLength: 3, maxLength: 9 },
      qty: { required: true, integer: true, min: 0, max: 99 },
      email: { required: true, format: 'email' },
      site: { required: false, format: 'url' },
      ref: { required: false, format: 'uuid' },
      slug: { required: true, pattern: { source: '^[a-z]+$', flags: 'i', message: 'letters only' } },
      status: { required: true, oneOf: ['draft', 'live'] },
      tags: { required: false },
    });
  });

  test('a string pattern keeps its modifiers', () => {
    class StringPatternDto {
      @Matches('^x+$', 'i') value: string;
    }
    expect(dtoConstraints(StringPatternDto).value).toEqual({ required: true, pattern: { source: '^x+$', flags: 'i' } });
  });
});

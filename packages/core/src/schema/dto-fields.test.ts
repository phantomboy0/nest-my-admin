import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { dtoOnlyField, dtoPropertyNames, isDtoPropertyOptional } from './dto-fields.js';

class SignupDto {
  @IsString() name: string;
  @IsOptional() @IsEmail() email?: string;
  @IsInt() age: number;
  @IsOptional() @IsBoolean() newsletter?: boolean;
  @IsString() password: string;
}

class StaffSignupDto extends SignupDto {
  @IsString() role: string;
}

describe('dto fields', () => {
  test('lists decorated properties once each', () => {
    expect(dtoPropertyNames(SignupDto)).toEqual(['name', 'email', 'age', 'newsletter', 'password']);
  });

  test('includes inherited properties', () => {
    expect([...dtoPropertyNames(StaffSignupDto)].sort()).toEqual(['age', 'email', 'name', 'newsletter', 'password', 'role']);
  });

  test('detects @IsOptional', () => {
    expect(isDtoPropertyOptional(SignupDto, 'email')).toBe(true);
    expect(isDtoPropertyOptional(SignupDto, 'name')).toBe(false);
  });

  test('builds a field for DTO-only properties from design:type', () => {
    expect(dtoOnlyField(SignupDto, 'age')).toEqual({
      name: 'age', label: 'Age', type: 'number', integer: true, nullable: false, primary: false, readonly: false, persisted: false,
    });
    expect(dtoOnlyField(SignupDto, 'newsletter')).toMatchObject({ type: 'boolean', nullable: true });
    expect(dtoOnlyField(SignupDto, 'password')).toMatchObject({ type: 'string', nullable: false });
  });

  test('DTO-only fields pick up enum values and integers', () => {
    class ChoiceDto {
      @IsIn(['a', 'b']) choice: string;
      @IsInt() count: number;
    }
    expect(dtoOnlyField(ChoiceDto, 'choice')).toMatchObject({ type: 'enum', enumValues: ['a', 'b'] });
    expect(dtoOnlyField(ChoiceDto, 'count')).toMatchObject({ type: 'number', integer: true });
  });

  test('a DTO-only @IsIn with non-string values stays a plain field', () => {
    class NumericChoiceDto {
      @IsIn([1, 2]) level: number;
    }
    expect(dtoOnlyField(NumericChoiceDto, 'level')).toMatchObject({ type: 'number' });
    expect(dtoOnlyField(NumericChoiceDto, 'level').enumValues).toBeUndefined();
  });
});

import { describe, expect, mock, test } from 'bun:test';
import { BadRequestException, ConflictException, InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { AdminFieldError, AdminNotFoundError } from '../errors.js';
import { codeForStatus, toErrorResponse } from './error-response.js';

const logger = () => ({ error: mock((_message: string) => {}) });
const dbError = (driverError: Record<string, unknown>) =>
  new QueryFailedError('INSERT ...', [], Object.assign(new Error(String(driverError.message)), driverError));

describe('toErrorResponse', () => {
  test('admin errors keep their code, status and fields', () => {
    expect(toErrorResponse(new AdminFieldError({ total: 'too big' }), 'c1', logger())).toEqual({
      status: 422,
      body: { code: 'VALIDATION', message: 'Validation failed', fields: { total: ['too big'] }, correlationId: 'c1' },
    });
    expect(toErrorResponse(new AdminNotFoundError('Widget "9" not found'), 'c2', logger()).body).toEqual({
      code: 'NOT_FOUND', message: 'Widget "9" not found', correlationId: 'c2',
    });
  });

  test('HttpExceptions thrown by host services pass through by status', () => {
    expect(toErrorResponse(new BadRequestException('Active products need stock'), 'c', logger())).toEqual({
      status: 400,
      body: { code: 'BUSINESS_RULE', message: 'Active products need stock', correlationId: 'c' },
    });
    expect(toErrorResponse(new ConflictException('Archived'), 'c', logger()).body.code).toBe('CONFLICT');
    expect(toErrorResponse(new NotFoundException(), 'c', logger()).body.code).toBe('NOT_FOUND');
    expect(toErrorResponse(new BadRequestException(['a must be x', 'b must be y']), 'c', logger()).body.message).toBe(
      'a must be x; b must be y',
    );
  });

  test('5xx and unknown errors are logged and hidden', () => {
    const log = logger();
    expect(toErrorResponse(new Error('db password is hunter2'), 'c9', log)).toEqual({
      status: 500,
      body: { code: 'INTERNAL', message: 'Internal error', correlationId: 'c9' },
    });
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(toErrorResponse(new InternalServerErrorException('secret detail'), 'c', logger()).body.message).toBe('Internal error');
  });

  test('unique violations become 409 CONFLICT on the field (SQLite, Postgres)', () => {
    const sqlite = toErrorResponse(dbError({ message: 'UNIQUE constraint failed: product.sku' }), 'c', logger());
    expect(sqlite).toEqual({
      status: 409,
      body: { code: 'CONFLICT', message: 'A record with this value already exists', fields: { sku: ['already exists'] }, correlationId: 'c' },
    });
    const postgres = toErrorResponse(
      dbError({ code: '23505', message: 'duplicate key value violates unique constraint "UQ_1"', detail: 'Key (sku_code)=(A1) already exists.' }),
      'c',
      logger(),
      new Map([['sku_code', 'skuCode']]),
    );
    expect(postgres.body.fields).toEqual({ skuCode: ['already exists'] });
  });

  test('not-null violations become 422 VALIDATION on the field (SQLite, MySQL)', () => {
    expect(toErrorResponse(dbError({ message: 'NOT NULL constraint failed: widget.name' }), 'c', logger())).toEqual({
      status: 422,
      body: { code: 'VALIDATION', message: 'A required value is missing', fields: { name: ['is required'] }, correlationId: 'c' },
    });
    expect(
      toErrorResponse(dbError({ code: 'ER_BAD_NULL_ERROR', message: "Column 'name' cannot be null" }), 'c', logger()).body.fields,
    ).toEqual({ name: ['is required'] });
  });

  test('status codes map to contract codes', () => {
    expect(codeForStatus(401)).toBe('UNAUTHENTICATED');
    expect(codeForStatus(403)).toBe('FORBIDDEN');
    expect(codeForStatus(404)).toBe('NOT_FOUND');
    expect(codeForStatus(409)).toBe('CONFLICT');
    expect(codeForStatus(413)).toBe('BAD_REQUEST');
    expect(codeForStatus(415)).toBe('BAD_REQUEST');
    expect(codeForStatus(422)).toBe('VALIDATION');
    expect(codeForStatus(400)).toBe('BUSINESS_RULE');
  });

  test('an UnauthorizedException from host code is UNAUTHENTICATED', () => {
    expect(toErrorResponse(new UnauthorizedException('Log in first'), 'c', logger()).body).toEqual({
      code: 'UNAUTHENTICATED', message: 'Log in first', correlationId: 'c',
    });
  });
});

describe('toErrorResponse: invalid values reaching the database', () => {
  test.each([
    [{ code: '22P02', message: 'invalid input syntax for type integer: "x"' }],
    [{ code: '22003', message: 'value out of range' }],
    [{ code: '22008', message: 'date/time field value out of range' }],
    [{ code: 'ER_WARN_DATA_OUT_OF_RANGE', message: 'Out of range value' }],
    [{ code: 'ER_TRUNCATED_WRONG_VALUE', message: 'Incorrect datetime value' }],
    [{ code: 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD', message: 'Incorrect integer value' }],
  ])('%p is a 422', (driver) => {
    expect(toErrorResponse(dbError(driver), 'c', logger())).toEqual({
      status: 422,
      body: { code: 'VALIDATION', message: 'A value is invalid for its column', correlationId: 'c' },
    });
  });

  test('names the column when the driver reports it', () => {
    expect(toErrorResponse(dbError({ code: '22003', message: 'out of range', column: 'stock' }), 'c', logger()).body.fields).toEqual({
      stock: ['is invalid'],
    });
  });
});

import { describe, expect, mock, test } from 'bun:test';
import { BadRequestException, ConflictException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { AdminFieldError, AdminNotFoundError } from '../errors.js';
import { toErrorResponse } from './error-response.js';

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
});

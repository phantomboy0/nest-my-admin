import { describe, expect, mock, test } from 'bun:test';
import { BadRequestException, ConflictException, InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { AdminError, AdminFieldError, AdminNotFoundError } from '../errors.js';
import { codeForStatus, toErrorResponse, type ErrorResponse } from './error-response.js';

const logger = () => ({ error: mock((_message: string) => {}) });
const dbError = (driverError: Record<string, unknown>) =>
  new QueryFailedError('INSERT ...', [], Object.assign(new Error(String(driverError.message)), driverError));
const dbNames = (columns: Record<string, string>, constraints: Record<string, string[]> = {}) => ({
  columns: new Map(Object.entries(columns)),
  constraints: new Map(Object.entries(constraints)),
});

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

  test('deleting a record other records still reference is 409 CONFLICT', () => {
    const conflict: ErrorResponse = { status: 409, body: { code: 'CONFLICT', message: 'The change conflicts with related records', correlationId: 'c' } };
    expect(toErrorResponse(dbError({ message: 'FOREIGN KEY constraint failed' }), 'c', logger(), { deleting: true })).toEqual(conflict);
    expect(
      toErrorResponse(
        dbError({ code: '23503', constraint: 'FK_1', message: 'update or delete on table "widget" violates foreign key constraint "FK_1" on table "gadget"', detail: 'Key (id)=(1) is still referenced from table "gadget".' }),
        'c',
        logger(),
        { deleting: true },
      ),
    ).toEqual(conflict);
    for (const code of ['ER_ROW_IS_REFERENCED_2', 'ER_ROW_IS_REFERENCED']) {
      expect(toErrorResponse(dbError({ code, message: 'Cannot delete or update a parent row' }), 'c', logger()).status).toBe(409);
    }
  });

  test('a foreign key pointing at a missing record is 422 on that field', () => {
    const names = dbNames({ widget_id: 'widgetId' }, { FK_8a2f: ['widgetId'] });
    const expected: ErrorResponse = {
      status: 422,
      body: { code: 'VALIDATION', message: 'A related record does not exist', fields: { widgetId: ['does not exist'] }, correlationId: 'c' },
    };
    // Postgres names the constraint
    const postgres = dbError({
      code: '23503',
      constraint: 'FK_8a2f',
      message: 'insert or update on table "gadget" violates foreign key constraint "FK_8a2f"',
      detail: 'Key (widget_id)=(999) is not present in table "widget".',
    });
    expect(toErrorResponse(postgres, 'c', logger(), { dbNames: names })).toEqual(expected);
    // MySQL, with and without the _2 suffix
    const mysqlMessage =
      'Cannot add or update a child row: a foreign key constraint fails (`db`.`gadget`, CONSTRAINT `FK_8a2f` FOREIGN KEY (`widget_id`) REFERENCES `widget` (`id`) ON DELETE RESTRICT)';
    expect(toErrorResponse(dbError({ code: 'ER_NO_REFERENCED_ROW_2', message: mysqlMessage }), 'c', logger(), { dbNames: names })).toEqual(expected);
    expect(toErrorResponse(dbError({ code: 'ER_NO_REFERENCED_ROW', message: 'Cannot add or update a child row' }), 'c', logger()).status).toBe(422);
    // SQLite does not say which side failed or which column: a write that is not a delete means a missing parent
    expect(toErrorResponse(dbError({ message: 'FOREIGN KEY constraint failed' }), 'c', logger(), { dbNames: names })).toEqual({
      status: 422,
      body: { code: 'VALIDATION', message: 'A related record does not exist', correlationId: 'c' },
    });
  });

  test('Postgres FK direction does not depend on the language of its messages (lc_messages)', () => {
    const names = dbNames({ widget_id: 'widgetId' }, { FK_8a2f: ['widgetId'] });
    // German server messages: nothing English to match, only the SQLSTATE and the constraint name
    const localized = { code: '23503', constraint: 'FK_8a2f', message: 'Einfügen oder Aktualisieren in Tabelle »gadget« verletzt Fremdschlüssel-Constraint', detail: 'Schlüssel (widget_id)=(9) ist nicht in Tabelle »widget« vorhanden.' };
    expect(toErrorResponse(dbError(localized), 'c', logger(), { dbNames: names })).toMatchObject({ status: 422, body: { fields: { widgetId: ['does not exist'] } } });
    expect(toErrorResponse(dbError(localized), 'c', logger(), { dbNames: names, deleting: true }).status).toBe(409);
  });

  test('without a known constraint name the column in the message is used (Postgres detail, MySQL FOREIGN KEY)', () => {
    const detailOnly = dbError({ code: '23503', message: 'insert or update on table "gadget"', detail: 'Key (widget_id)=(9) is not present in table "widget".' });
    expect(toErrorResponse(detailOnly, 'c', logger(), { dbNames: dbNames({ widget_id: 'widgetId' }) }).body.fields).toEqual({ widgetId: ['does not exist'] });
    const mysql = dbError({ code: 'ER_NO_REFERENCED_ROW_2', message: 'a foreign key constraint fails (`db`.`gadget`, CONSTRAINT `FK_x` FOREIGN KEY (`widget_id`) REFERENCES `widget` (`id`))' });
    expect(toErrorResponse(mysql, 'c', logger()).body.fields).toEqual({ widget_id: ['does not exist'] });
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
      { dbNames: dbNames({ sku_code: 'skuCode' }) },
    );
    expect(postgres.body.fields).toEqual({ skuCode: ['already exists'] });
  });

  test('unique violations name every column of the constraint (MySQL index names, Postgres constraint names, SQLite column lists)', () => {
    const names = dbNames({ serial_no: 'serial' }, { UQ_gadget_batch_serial: ['batch', 'serial'], IDX_f3cd: ['sku'] });
    const both = { batch: ['already exists'], serial: ['already exists'] };
    const mysql = dbError({ code: 'ER_DUP_ENTRY', message: "Duplicate entry 'a-b' for key 'gadget.UQ_gadget_batch_serial'" });
    expect(toErrorResponse(mysql, 'c', logger(), { dbNames: names }).body.fields).toEqual(both);
    const postgres = dbError({ code: '23505', constraint: 'UQ_gadget_batch_serial', message: 'duplicate key', detail: 'Key (batch, serial)=(a, b) already exists.' });
    expect(toErrorResponse(postgres, 'c', logger(), { dbNames: names }).body.fields).toEqual(both);
    const sqlite = dbError({ message: 'UNIQUE constraint failed: gadget.batch, gadget.serial_no' });
    expect(toErrorResponse(sqlite, 'c', logger(), { dbNames: names }).body.fields).toEqual(both);
    const single = dbError({ code: 'ER_DUP_ENTRY', message: "Duplicate entry 'X' for key 'product.IDX_f3cd'" });
    expect(toErrorResponse(single, 'c', logger(), { dbNames: names }).body.fields).toEqual({ sku: ['already exists'] });
  });

  test('not-null violations become 422 VALIDATION on the field (SQLite, MySQL)', () => {
    expect(toErrorResponse(dbError({ message: 'NOT NULL constraint failed: widget.name' }), 'c', logger())).toEqual({
      status: 422,
      body: { code: 'VALIDATION', message: 'A required value is missing', fields: { name: ['is required'] }, correlationId: 'c' },
    });
    expect(
      toErrorResponse(dbError({ code: 'ER_BAD_NULL_ERROR', message: "Column 'name' cannot be null" }), 'c', logger()).body.fields,
    ).toEqual({ name: ['is required'] });
    expect(
      toErrorResponse(dbError({ code: 'ER_NO_DEFAULT_FOR_FIELD', message: "Field 'name' doesn't have a default value" }), 'c', logger()),
    ).toEqual({
      status: 422,
      body: { code: 'VALIDATION', message: 'A required value is missing', fields: { name: ['is required'] }, correlationId: 'c' },
    });
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
    [{ code: 'ER_DATA_TOO_LONG', message: 'Data too long' }],
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

  test('MySQL names the column in the message', () => {
    const tooLong = dbError({ code: 'ER_DATA_TOO_LONG', message: "Data too long for column 'name' at row 1" });
    expect(toErrorResponse(tooLong, 'c', logger()).body.fields).toEqual({ name: ['is invalid'] });
    const range = dbError({ code: 'ER_WARN_DATA_OUT_OF_RANGE', message: "Out of range value for column 'stock' at row 1" });
    expect(toErrorResponse(range, 'c', logger()).body.fields).toEqual({ stock: ['is invalid'] });
  });

  test('a numeric driverError.column (mysql2, sql.js report a position) is ignored', () => {
    const res = toErrorResponse(dbError({ code: '23502', column: 21, message: 'null value' }), 'c', logger());
    expect(res.body.fields).toBeUndefined();
  });

  test('errorMapper translates host exceptions (Review Focus 4)', () => {
    class OutOfStock extends Error {}
    const mapper = (error: unknown) => (error instanceof OutOfStock ? new AdminFieldError({ stock: 'out of stock' }) : undefined);
    expect(toErrorResponse(new OutOfStock(), 'c', logger(), { errorMapper: mapper }).body).toEqual({
      code: 'VALIDATION', message: 'Validation failed', fields: { stock: ['out of stock'] }, correlationId: 'c',
    });
    expect(toErrorResponse(new Error('other'), 'c', logger(), { errorMapper: mapper }).status).toBe(500);
  });

  test('a mapper that throws or returns a non-AdminError is ignored and logged', () => {
    const log = logger();
    const throwing = () => {
      throw new Error('mapper bug');
    };
    expect(toErrorResponse(new NotFoundException(), 'c', log, { errorMapper: throwing }).body.code).toBe('NOT_FOUND');
    expect(log.error).toHaveBeenCalledTimes(1);
    const bogus = () => ({ code: 'NOT_A_REAL_ERROR' }) as unknown as AdminError;
    expect(toErrorResponse(new NotFoundException(), 'c', logger(), { errorMapper: bogus }).body.code).toBe('NOT_FOUND');
  });

  test('AdminErrors are never passed to the mapper', () => {
    let called = false;
    toErrorResponse(new AdminNotFoundError(), 'c', logger(), {
      errorMapper: () => {
        called = true;
        return undefined;
      },
    });
    expect(called).toBe(false);
  });

  test('a mapper result with status >= 500 logs the original error and correlation id', () => {
    const log = logger();
    const original = new Error('boom from domain');
    const res = toErrorResponse(original, 'c500', log, { errorMapper: () => new AdminError('BUSINESS_RULE', 503, 'Try later') });
    expect(res.status).toBe(503);
    expect(log.error).toHaveBeenCalledTimes(1);
    const message = log.error.mock.calls[0]![0];
    expect(message).toContain('c500');
    expect(message).toContain('boom from domain');
  });

  test('a mapper result with a 4xx status is not logged', () => {
    const log = logger();
    toErrorResponse(new Error('x'), 'c', log, { errorMapper: () => new AdminError('BUSINESS_RULE', 402, 'Pay') });
    expect(log.error).not.toHaveBeenCalled();
  });
});

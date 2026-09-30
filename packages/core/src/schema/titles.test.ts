import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Column, DataSource, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { compileTitle } from './titles.js';

@Entity()
class Person {
  @PrimaryGeneratedColumn() id: number;
  @Column() email: string;
  @Column() fullName: string;
  @Column({ type: 'int' }) age: number;
}

@Entity()
class Reading {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'int' }) value: number;
}

let dataSource: DataSource;
beforeAll(async () => {
  dataSource = await new DataSource({ type: 'sqljs', entities: [Person, Reading] }).initialize();
});
afterAll(async () => {
  await dataSource.destroy();
});

const fail = (message: string): never => {
  throw new Error(message);
};

describe('compileTitle', () => {
  test('defaults to the first title-like string column, in preference order', () => {
    const title = compileTitle(undefined, dataSource.getMetadata(Person), fail);
    expect(title({ id: 1, email: 'ada@example.com', fullName: 'Ada Lovelace' })).toBe('Ada Lovelace');
  });

  test('falls back to #id when there is no title column or the value is empty', () => {
    expect(compileTitle(undefined, dataSource.getMetadata(Reading), fail)({ id: 7, value: 3 })).toBe('#7');
    expect(compileTitle(undefined, dataSource.getMetadata(Person), fail)({ id: 2, fullName: '  ' })).toBe('#2');
  });

  test('a column title reads that column; numbers are turned into text', () => {
    expect(compileTitle('email', dataSource.getMetadata(Person), fail)({ id: 1, email: 'a@b.c' })).toBe('a@b.c');
    expect(compileTitle('age', dataSource.getMetadata(Person), fail)({ id: 1, age: 36 })).toBe('36');
  });

  test('a function title that throws or returns nothing falls back to #id', () => {
    const metadata = dataSource.getMetadata(Person);
    expect(compileTitle((p: Person) => `${p.fullName} (${p.age})`, metadata, fail)({ id: 1, fullName: 'Ada', age: 36 })).toBe('Ada (36)');
    expect(compileTitle((p: { company: { name: string } }) => p.company.name, metadata, fail)({ id: 3 })).toBe('#3');
    expect(compileTitle(() => undefined as unknown as string, metadata, fail)({ id: 4 })).toBe('#4');
  });

  test('an unknown title column fails with a suggestion', () => {
    expect(() => compileTitle('emial', dataSource.getMetadata(Person), fail)).toThrow('title: unknown column "emial" on Person (did you mean "email"?)');
  });
});

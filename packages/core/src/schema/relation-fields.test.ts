import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Column, DataSource, Entity, JoinColumn, ManyToMany, ManyToOne, OneToMany, OneToOne, PrimaryColumn, PrimaryGeneratedColumn, type Relation } from 'typeorm';
import { ORDER_ENTITIES, Order } from '../../test/fixtures/orders.js';
import { relationFields, resolvePath, pathField } from './relation-fields.js';

@Entity()
class Pair {
  @PrimaryColumn() a: string;
  @PrimaryColumn() b: string;
}

@Entity()
class Author {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @OneToMany(() => Book, (book) => book.author) books: Book[];
}

@Entity()
class Book {
  @PrimaryGeneratedColumn() id: number;
  @ManyToOne(() => Author, (author) => author.books) author: Author;
  @ManyToOne(() => Author, { lazy: true }) editor: Promise<Author>;
  @ManyToOne(() => Pair) pair: Pair;
  @OneToOne(() => Profile, (profile) => profile.book) profile: Relation<Profile>;
  @ManyToMany(() => Author, { cascade: false }) fans: Author[]; // no @JoinTable here: owning side is decided by JoinTable
}

@Entity()
class Profile {
  @PrimaryGeneratedColumn() id: number;
  @OneToOne(() => Book, (book) => book.profile) @JoinColumn() book: Book;
}

let dataSource: DataSource;
beforeAll(async () => {
  dataSource = await new DataSource({ type: 'sqljs', entities: [...ORDER_ENTITIES, Pair, Author, Book, Profile], synchronize: false }).initialize();
});
afterAll(async () => {
  await dataSource.destroy();
});

describe('relationFields', () => {
  test('many-to-one, explicit id column and many-to-many', () => {
    const fields = relationFields(dataSource.getMetadata(Order)).map(({ field }) => field);
    expect(fields).toEqual([
      { name: 'customer', label: 'Customer', type: 'relation', nullable: false, primary: false, readonly: false, persisted: true, integer: true, relation: { kind: 'to-one', idType: 'number' } },
      { name: 'sellerId', label: 'Seller', type: 'relation', nullable: true, primary: false, readonly: false, persisted: true, integer: true, relation: { kind: 'to-one', idType: 'number' } },
      { name: 'tags', label: 'Tags', type: 'relation', nullable: true, primary: false, readonly: false, persisted: true, relation: { kind: 'to-many', idType: 'uuid' } },
    ]);
  });

  test('inverse sides, lazy relations and targets with composite keys are not fields', () => {
    expect(relationFields(dataSource.getMetadata(Author))).toEqual([]);
    expect(relationFields(dataSource.getMetadata(Book)).map(({ field }) => field.name)).toEqual(['author']);
    expect(relationFields(dataSource.getMetadata(Profile)).map(({ field }) => field.name)).toEqual(['book']);
  });
});

describe('resolvePath', () => {
  test('walks to-one relations to a column', () => {
    const resolved = resolvePath(dataSource.getMetadata(Order), 'customer.company.name');
    expect('error' in resolved).toBe(false);
    if ('error' in resolved) return;
    expect(resolved.relations.map((relation) => relation.propertyName)).toEqual(['customer', 'company']);
    expect(resolved.column.propertyName).toBe('name');
    expect(pathField('customer.company.name', resolved)).toMatchObject({ name: 'customer.company.name', label: 'Customer company name', type: 'string', readonly: true, persisted: true });
  });

  test('explains paths that cannot work', () => {
    const metadata = dataSource.getMetadata(Order);
    expect(resolvePath(metadata, 'customer.nam')).toMatchObject({ error: 'unknown path', candidates: ['customer.id', 'customer.name', 'customer.active'] });
    expect(resolvePath(metadata, 'tags.label')).toMatchObject({ error: '"tags" is not a many-to-one or owning one-to-one relation' });
    expect(resolvePath(metadata, 'nope.name')).toMatchObject({ error: 'unknown path', candidates: ['customer.name', 'seller.name'] });
    expect(resolvePath(metadata, 'customer.company.name.x')).toMatchObject({ error: 'paths have at most 3 segments' });
    expect(resolvePath(metadata, 'customer.company')).toMatchObject({ error: 'unknown path' }); // a relation, not a column
  });
});

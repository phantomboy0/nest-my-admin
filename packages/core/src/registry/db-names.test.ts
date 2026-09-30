import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { Column, DataSource, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { dbNamesFor } from './db-names.js';

@Entity()
class Maker {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 20, unique: true }) code: string;
}

@Entity()
@Unique('UQ_part_lot_serial', ['lot', 'serial'])
class Part {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 20 }) lot: string;
  @Column({ length: 20, name: 'serial_no' }) serial: string;
  @Column({ type: 'int', name: 'maker_id' }) makerId: number;
  @ManyToOne(() => Maker) @JoinColumn({ name: 'maker_id' }) maker: Maker;
}

describe('dbNamesFor', () => {
  test('maps columns, unique constraints and foreign keys to properties (real TypeORM metadata)', async () => {
    const dataSource = await new DataSource({ type: 'sqljs', entities: [Maker, Part], synchronize: true }).initialize();
    const names = dbNamesFor(dataSource.getMetadata(Part));
    expect(names.columns.get('serial_no')).toBe('serial');
    expect(names.columns.get('maker_id')).toBe('makerId');
    expect(names.constraints.get('UQ_part_lot_serial')).toEqual(['lot', 'serial']);
    const foreignKey = dataSource.getMetadata(Part).foreignKeys[0]!.name;
    expect(names.constraints.get(foreignKey)).toEqual(['makerId']);
    const unique = dataSource.getMetadata(Maker).uniques[0]!.name;
    expect(dbNamesFor(dataSource.getMetadata(Maker)).constraints.get(unique)).toEqual(['code']);
    await dataSource.destroy();
  });

  test('unique indexes count (MySQL stores unique constraints as indexes); plain indexes do not', () => {
    const names = dbNamesFor({
      columns: [],
      uniques: [],
      indices: [
        { name: 'IDX_unique', isUnique: true, columns: [{ propertyName: 'sku' }] },
        { name: 'IDX_plain', isUnique: false, columns: [{ propertyName: 'name' }] },
      ],
      foreignKeys: [],
    });
    expect(names.constraints.get('IDX_unique')).toEqual(['sku']);
    expect(names.constraints.has('IDX_plain')).toBe(false);
  });
});

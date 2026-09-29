import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule, getDataSourceToken } from '@nestjs/typeorm';
import { Column, DataSource, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
class Probe {
  @PrimaryGeneratedColumn() id: number;
  @Column() label: string;
}

@Injectable()
class ProbeService {
  constructor(readonly dataSource: DataSource) {}
}

@Module({
  imports: [TypeOrmModule.forRoot({ type: 'sqljs', entities: [Probe], synchronize: true })],
  providers: [ProbeService],
})
class ProbeModule {}

describe('toolchain', () => {
  test('emits decorator metadata so Nest can inject by type', () => {
    expect(Reflect.getMetadata('design:paramtypes', ProbeService)).toEqual([DataSource]);
  });

  test('boots Nest 12 + TypeORM 1 on sql.js', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    const service = moduleRef.get(ProbeService);
    expect(service.dataSource).toBe(moduleRef.get(getDataSourceToken()));
    const repository = service.dataSource.getRepository(Probe);
    await repository.save({ label: 'ok' });
    expect(await repository.count()).toBe(1);
    await moduleRef.close();
  });
});

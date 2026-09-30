// A CommonJS host: tsc emits require() calls, and Node loads the ESM @nest-my-admin/core through require(esm).
import 'reflect-metadata';
import { AdminGroup, AdminModule, AdminResource, AdminResourceBase } from '@nest-my-admin/core';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
class Note {
  @PrimaryGeneratedColumn() id: number;
  @Column() title: string;
}

@AdminResource(Note)
class NoteAdmin extends AdminResourceBase<Note> {}

@AdminGroup({ label: 'Notes' })
@Module({ providers: [NoteAdmin] })
class NotesModule {}

@Module({
  imports: [TypeOrmModule.forRoot({ type: 'sqljs', entities: [Note], synchronize: true }), AdminModule.forRoot({ title: 'Smoke' }), NotesModule],
})
class AppModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  await app.listen(Number(process.env.PORT));
  console.log('READY');
}
void bootstrap();

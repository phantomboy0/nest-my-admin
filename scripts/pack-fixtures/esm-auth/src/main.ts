import 'reflect-metadata';
import { ADMIN_AUTH_ENTITIES, builtinAuth } from '@nest-my-admin/auth';
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
  imports: [TypeOrmModule.forRoot({ type: 'sqljs', entities: [Note, ...ADMIN_AUTH_ENTITIES], synchronize: true }), AdminModule.forRoot({ title: 'Smoke', auth: builtinAuth({ bootstrapSuperuser: { username: 'smoke', password: 'smoke-password' } }) }), NotesModule],
})
class AppModule {}

const app = await NestFactory.create(AppModule, { logger: ['error'] });
await app.listen(Number(process.env.PORT));
console.log('READY');

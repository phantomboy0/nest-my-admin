import { Module } from '@nestjs/common';
import type { SelectQueryBuilder } from 'typeorm';
import { Column, DeleteDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AdminResource, AdminResourceBase, type AdminContext } from '../../src/index.js';

@Entity()
export class Label {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 20 }) name: string;
}

/** Only owner 1's notes are visible to the admin (NoteAdmin.query). */
@Entity()
export class Note {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'int' }) ownerId: number;
  @Column({ length: 40 }) text: string;
  @ManyToOne(() => Label, { eager: true, nullable: true }) label: Label | null;
  @DeleteDateColumn() deletedAt: Date | null;
}

@Entity()
export class Comment {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) body: string;
  @ManyToOne(() => Note, { nullable: true }) note: Note | null;
}

@AdminResource(Note, { title: 'text' })
export class NoteAdmin extends AdminResourceBase<Note> {
  query(qb: SelectQueryBuilder<Note>, _ctx: AdminContext) {
    return qb.andWhere(`${qb.alias}.ownerId = :owner`, { owner: 1 });
  }
}

@AdminResource(Comment)
export class CommentAdmin extends AdminResourceBase<Comment> {}

@Module({ providers: [NoteAdmin, CommentAdmin] })
export class NotesModule {}

export const NOTE_ENTITIES: Function[] = [Label, Note, Comment];

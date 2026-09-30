import { Module } from '@nestjs/common';
import { ChildEntity, Column, Entity, PrimaryGeneratedColumn, TableInheritance } from 'typeorm';
import { AdminResource, AdminResourceBase } from '../../src/index.js';

/** Single-table inheritance: one `content` table, discriminator `kind`. */
@Entity()
@TableInheritance({ column: { type: 'varchar', length: 20, name: 'kind' } })
export class Content {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 60 }) title: string;
}

@ChildEntity('post')
export class Post extends Content {
  @Column({ type: 'text', nullable: true }) body: string | null;
}

@ChildEntity('video')
export class Video extends Content {
  @Column({ type: 'int', nullable: true }) seconds: number | null;
}

@AdminResource(Content)
export class ContentAdmin extends AdminResourceBase<Content> {}

@AdminResource(Post)
export class PostAdmin extends AdminResourceBase<Post> {}

@Module({ providers: [ContentAdmin, PostAdmin] })
export class ContentModule {}

export const CONTENT_ENTITIES: Function[] = [Content, Post, Video];

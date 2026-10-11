import { AdminGroup, AdminResource, AdminResourceBase, type FieldsConfig, type ListConfig } from '@nest-my-admin/core';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Article } from './article.entity.js';

@AdminResource(Article, { icon: 'file-text', label: { en: 'Article', fa: 'مقاله' }, title: 'title' })
export class ArticleAdmin extends AdminResourceBase<Article> {
  list: ListConfig<Article> = { columns: ['id', 'title', 'createdAt'], sort: '-id', search: ['title'] };
  /** Images placed in the text are uploaded to the admin's storage and shown to everyone who may read the article. */
  fields: FieldsConfig<Article> = {
    title: { label: { en: 'Title', fa: 'عنوان' } },
    body: { widget: 'richtext', label: { en: 'Body', fa: 'متن' } },
  };
}

@AdminGroup({ label: { en: 'Content', fa: 'محتوا' }, icon: 'book' })
@Module({ imports: [TypeOrmModule.forFeature([Article])], providers: [ArticleAdmin] })
export class ContentModule {}

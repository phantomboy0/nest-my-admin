import { AdminResource, AdminResourceBase, type ListConfig } from '@nest-my-admin/core';
import { Category } from './category.entity.js';
import { Supplier } from './supplier.entity.js';
import { Tag } from './tag.entity.js';

@AdminResource(Category, { icon: 'folder' })
export class CategoryAdmin extends AdminResourceBase<Category> {
  list: ListConfig<Category> = { columns: ['id', 'name'], sort: 'name' };
}

@AdminResource(Tag, { icon: 'tag' })
export class TagAdmin extends AdminResourceBase<Tag> {
  list: ListConfig<Tag> = { columns: ['id', 'name'], sort: 'name' };
}

@AdminResource(Supplier, { icon: 'truck' })
export class SupplierAdmin extends AdminResourceBase<Supplier> {
  list: ListConfig<Supplier> = { columns: ['id', 'name', 'contact.email', 'contact.phone'], search: ['name', 'contact.email'] };
}

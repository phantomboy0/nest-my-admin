import { AdminResource, AdminResourceBase, type ListConfig } from '@nest-my-admin/core';
import { Category } from './category.entity.js';
import { StockMove } from './stock-move.entity.js';
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

@AdminResource(StockMove, { icon: 'history', title: (move: StockMove) => `${move.delta > 0 ? '+' : ''}${move.delta} (${move.reason})` })
export class StockMoveAdmin extends AdminResourceBase<StockMove> {
  list: ListConfig<StockMove> = { columns: ['id', 'productId', 'delta', 'reason'], sort: '-id', pageSize: 10, pagination: 'keyset', filters: ['productId'] };
}

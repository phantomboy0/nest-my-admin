import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager, Repository } from 'typeorm';
import type { CreateProductDto, UpdateProductDto } from './product.dto.js';
import { Product } from './product.entity.js';

/** The app's own business logic. The admin calls it instead of writing to the table directly. */
@Injectable()
export class ProductsService {
  constructor(@InjectRepository(Product) private readonly products: Repository<Product>) {}

  /** Pass the admin's ctx.manager to write inside its transaction; plain callers omit it. */
  private repo(manager?: EntityManager): Repository<Product> {
    return manager ? manager.getRepository(Product) : this.products;
  }

  async create(dto: CreateProductDto, manager?: EntityManager): Promise<Product> {
    const products = this.repo(manager);
    const product = products.create({ ...dto, sku: dto.sku.toUpperCase() });
    this.assertSellable(product);
    return products.save(product);
  }

  async update(id: number, dto: UpdateProductDto, manager?: EntityManager): Promise<Product> {
    const products = this.repo(manager);
    const product = await products.findOneByOrFail({ id });
    if (product.status === 'archived') throw new ConflictException('Archived products are read-only');
    products.merge(product, dto);
    this.assertSellable(product);
    return products.save(product);
  }

  async remove(id: number, manager?: EntityManager): Promise<void> {
    const products = this.repo(manager);
    const product = await products.findOneByOrFail({ id });
    if (product.status === 'active') throw new ConflictException('Active products cannot be deleted; archive them first');
    await products.remove(product);
  }

  private assertSellable(product: Product): void {
    if (product.status === 'active' && (product.stock ?? 0) <= 0) {
      throw new BadRequestException('Active products need stock');
    }
  }
}

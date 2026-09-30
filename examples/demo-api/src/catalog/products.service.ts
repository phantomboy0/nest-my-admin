import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import type { CreateProductDto, UpdateProductDto } from './product.dto.js';
import { Product } from './product.entity.js';

/** The app's own business logic. The admin calls it instead of writing to the table directly. */
@Injectable()
export class ProductsService {
  constructor(@InjectRepository(Product) private readonly products: Repository<Product>) {}

  async create(dto: CreateProductDto): Promise<Product> {
    const product = this.products.create({ ...dto, sku: dto.sku.toUpperCase() });
    this.assertSellable(product);
    return this.products.save(product);
  }

  async update(id: number, dto: UpdateProductDto): Promise<Product> {
    const product = await this.products.findOneByOrFail({ id });
    if (product.status === 'archived') throw new ConflictException('Archived products are read-only');
    this.products.merge(product, dto);
    this.assertSellable(product);
    return this.products.save(product);
  }

  async remove(id: number): Promise<void> {
    const product = await this.products.findOneByOrFail({ id });
    if (product.status === 'active') throw new ConflictException('Active products cannot be deleted; archive them first');
    await this.products.remove(product);
  }

  private assertSellable(product: Product): void {
    if (product.status === 'active' && (product.stock ?? 0) <= 0) {
      throw new BadRequestException('Active products need stock');
    }
  }
}

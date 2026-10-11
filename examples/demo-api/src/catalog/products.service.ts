import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager, Repository } from 'typeorm';
import type { CreateProductDto, UpdateProductDto } from './product.dto.js';
import { Product } from './product.entity.js';

type ProductInput = Pick<CreateProductDto, 'tags' | 'image' | 'gallery'>;

/**
 * What the entity stores for what the admin sends: tag ids become references, uploaded files their storage keys.
 * A property the DTO does not have is left alone.
 */
function toColumns<T extends ProductInput>(dto: T): Omit<T, keyof ProductInput> & { tags?: Array<{ id: number }>; image?: string | null; gallery?: string[] | null } {
  const { tags, image, gallery, ...rest } = dto;
  return {
    ...rest,
    ...(tags === undefined ? {} : { tags: tags.map((id) => ({ id })) }),
    ...(image === undefined ? {} : { image: image?.key ?? null }),
    ...(gallery === undefined ? {} : { gallery: gallery?.map((file) => file.key) ?? null }),
  };
}

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
    const product = products.create({ ...toColumns(dto), sku: dto.sku.toUpperCase() });
    this.assertSellable(product);
    return products.save(product);
  }

  async update(id: number, dto: UpdateProductDto, manager?: EntityManager): Promise<Product> {
    const products = this.repo(manager);
    const product = await products.findOneByOrFail({ id });
    // An archived product can only be brought back (a status change on its own).
    if (product.status === 'archived' && Object.keys(dto).some((key) => key !== 'status')) throw new ConflictException('Archived products are read-only');
    const { gallery, ...columns } = toColumns(dto);
    products.merge(product, columns);
    if (gallery !== undefined) product.gallery = gallery; // merge() would combine the old list with the new one
    this.assertSellable(product);
    return products.save(product);
  }

  async remove(id: number, manager?: EntityManager): Promise<void> {
    const products = this.repo(manager);
    const product = await products.findOneByOrFail({ id });
    if (product.status === 'active') throw new ConflictException('Active products cannot be deleted; archive them first');
    await products.softRemove(product);
  }

  private assertSellable(product: Product): void {
    if (product.status === 'active' && (product.stock ?? 0) <= 0) {
      throw new BadRequestException('Active products need stock');
    }
  }
}

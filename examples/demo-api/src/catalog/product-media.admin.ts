import { AdminResource, AdminResourceBase, type AdminFile, type FieldsConfig, type FormConfig } from '@nest-my-admin/core';
import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { ProductMedia } from './product-media.entity.js';

export class ProductMediaDto {
  @IsOptional() image?: AdminFile | null;
  @IsOptional() @IsString() @Length(0, 120) caption?: string;
  @IsOptional() @IsInt() @Min(0) sort?: number;
}

/** Pictures of a product, edited in a table inside the product's form (an inline child: no sidebar entry). */
@AdminResource(ProductMedia, { name: 'product-media', icon: 'image', label: { en: 'Picture', fa: 'تصویر' }, title: 'caption' })
export class ProductMediaAdmin extends AdminResourceBase<ProductMedia> {
  fields: FieldsConfig<ProductMedia> = {
    image: { widget: 'image', label: { en: 'Picture', fa: 'تصویر' }, file: { visibility: 'public', maxBytes: 2 * 1024 * 1024 } },
    caption: { label: { en: 'Caption', fa: 'متن جایگزین' } },
    sort: { label: { en: 'Order', fa: 'ترتیب' } },
  };
  form: FormConfig = { create: ProductMediaDto, update: ProductMediaDto };
}

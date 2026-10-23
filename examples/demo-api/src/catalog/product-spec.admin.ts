import { AdminResource, AdminResourceBase, type FieldsConfig, type FormConfig, type ListConfig } from '@nest-my-admin/core';
import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { ProductSpec } from './product-spec.entity.js';

export class CreateProductSpecDto {
  @IsString() @Length(1, 80) label: string;
  @IsString() @Length(1, 200) value: string;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string | null;
  @IsOptional() @IsInt() @Min(0) position?: number;
}

export class UpdateProductSpecDto {
  @IsOptional() @IsString() @Length(1, 80) label?: string;
  @IsOptional() @IsString() @Length(1, 200) value?: string;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string | null;
  @IsOptional() @IsInt() @Min(0) position?: number;
}

/** Specification lines of a product; people edit them as cards in the product's form (`product-spec.*` permissions). */
@AdminResource(ProductSpec, { name: 'product-spec', icon: 'list', label: { en: 'Specification', fa: 'مشخصه' }, title: 'label' })
export class ProductSpecAdmin extends AdminResourceBase<ProductSpec> {
  list: ListConfig<ProductSpec> = { columns: ['id', 'productId', 'label', 'value'], filters: ['productId'] };
  fields: FieldsConfig<ProductSpec> = {
    label: { label: { en: 'Name', fa: 'عنوان' } },
    value: { label: { en: 'Value', fa: 'مقدار' } },
    notes: { widget: 'textarea', label: { en: 'Notes', fa: 'توضیحات' } },
    position: { label: { en: 'Position', fa: 'جایگاه' } },
  };
  form: FormConfig = {
    create: CreateProductSpecDto,
    update: UpdateProductSpecDto,
    layout: [{ fields: ['label', 'value'], columns: 2 }, { fields: ['notes'], columns: 1 }],
  };
}

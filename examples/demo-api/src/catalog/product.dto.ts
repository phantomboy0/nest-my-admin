import { ArrayMaxSize, IsArray, IsDateString, IsDecimal, IsIn, IsInt, IsOptional, IsString, Length, Matches, Min } from 'class-validator';
import { PRODUCT_STATUSES, type ProductStatus } from './product.entity.js';

export class CreateProductDto {
  @IsString() @Length(1, 120) name: string;
  @IsString() @Matches(/^[A-Za-z0-9-]{2,40}$/, { message: 'sku must be 2-40 letters, digits or dashes' }) sku: string;
  @IsDecimal({ decimal_digits: '0,2' }) price: string;
  @IsOptional() @IsInt() @Min(0) stock?: number;
  @IsOptional() @IsIn(PRODUCT_STATUSES) status?: ProductStatus;
  @IsOptional() @IsDateString({ strict: true }) releasedOn?: string | null;
  @IsOptional() @IsInt() categoryId?: number | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsInt({ each: true }) tags?: number[];
}

/** SKU is fixed after creation, so it is not part of the update DTO. */
export class UpdateProductDto {
  @IsOptional() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @IsDecimal({ decimal_digits: '0,2' }) price?: string;
  @IsOptional() @IsInt() @Min(0) stock?: number;
  @IsOptional() @IsIn(PRODUCT_STATUSES) status?: ProductStatus;
  @IsOptional() @IsDateString({ strict: true }) releasedOn?: string | null;
  @IsOptional() @IsInt() categoryId?: number | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsInt({ each: true }) tags?: number[];
}

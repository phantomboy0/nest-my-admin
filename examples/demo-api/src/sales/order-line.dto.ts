import { IsDecimal, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateOrderLineDto {
  @IsOptional() @IsInt() productId?: number | null;
  @IsString() @Length(1, 120) description: string;
  @IsInt() @Min(1) @Max(999) quantity: number;
  @IsDecimal({ decimal_digits: '0,2' }) unitPrice: string;
  @IsOptional() @IsInt() @Min(0) position?: number;
}

export class UpdateOrderLineDto {
  @IsOptional() @IsInt() productId?: number | null;
  @IsOptional() @IsString() @Length(1, 120) description?: string;
  @IsOptional() @IsInt() @Min(1) @Max(999) quantity?: number;
  @IsOptional() @IsDecimal({ decimal_digits: '0,2' }) unitPrice?: string;
  @IsOptional() @IsInt() @Min(0) position?: number;
}

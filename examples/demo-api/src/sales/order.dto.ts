import { AdminField } from '@nest-my-admin/core';
import { IsDecimal, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export class CreateOrderDto {
  @IsString() @Matches(/^[A-Za-z0-9-]{3,40}$/, { message: 'number must be 3-40 letters, digits or dashes' }) number: string;
  @IsString() @Length(1, 120) customer: string;
  @IsDecimal({ decimal_digits: '0,2' }) total: string;
}

/** The number is fixed once the order exists; status and tracking code change through actions only. */
export class UpdateOrderDto {
  @IsOptional() @IsString() @Length(1, 120) customer?: string;
  @IsOptional() @IsDecimal({ decimal_digits: '0,2' }) total?: string;
}

/** The form of the Ship action. */
export class ShipOrderDto {
  @AdminField({
    label: { en: 'Tracking code', fa: 'کد رهگیری' },
    help: { en: 'The code the courier gave for the parcel.', fa: 'کدی که شرکت پست برای بسته داده است.' },
    placeholder: 'TRK-000000',
  })
  @IsString()
  @Length(4, 40)
  tracking: string;
}

/** The form of "Cancel stale drafts". */
export class StaleDraftsDto {
  @AdminField({
    label: { en: 'Older than (days)', fa: 'قدیمی‌تر از (روز)' },
    help: { en: '30 when left empty.', fa: 'اگر خالی بماند، ۳۰.' },
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  olderThanDays?: number = 30;
}

import { AdminAction, AdminField, AdminFieldError, AdminSource, AdminSourceBase, inMemoryList, type ActionOutcome, type ListConfig, type ListParams } from '@nest-my-admin/core';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

const ZONES = ['domestic', 'regional', 'international'];

/** A courier as the (pretend) shipping provider's API answers it: not a table of this app. */
export class CourierRow {
  @IsString() code: string;
  @AdminField({ label: { en: 'Name', fa: 'نام' } }) @IsString() name: string;
  @AdminField({ label: { en: 'Zone', fa: 'محدوده' }, enumLabels: { domestic: { en: 'Domestic', fa: 'داخلی' }, regional: { en: 'Regional', fa: 'منطقه‌ای' }, international: { en: 'International', fa: 'بین‌المللی' } } })
  @IsIn(ZONES)
  zone: string;
  @AdminField({ label: { en: 'Price per kg', fa: 'قیمت هر کیلو' } }) @IsInt() pricePerKg: number;
  @AdminField({ label: { en: 'Active', fa: 'فعال' } }) @IsBoolean() active: boolean;
}

export class CreateCourierDto {
  @AdminField({ help: { en: 'Two to six letters; the provider’s code.', fa: 'دو تا شش حرف؛ کد شرکت حمل.' } })
  @IsString()
  @Length(2, 6)
  code: string;
  @IsString() @Length(1, 60) name: string;
  @IsIn(ZONES) zone: string;
  @IsInt() @Min(0) pricePerKg: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateCourierDto {
  @IsOptional() @IsString() @Length(1, 60) name?: string;
  @IsOptional() @IsInt() @Min(0) pricePerKg?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class QuoteDto {
  @AdminField({ label: { en: 'Weight (kg)', fa: 'وزن (کیلو)' } }) @IsInt() @Min(1) kg: number;
  @AdminField({ label: { en: 'Speed', fa: 'سرعت' }, default: 'standard', help: { en: 'The provider’s services, read when the dialog opens.', fa: 'خدمات شرکت حمل، هنگام باز شدن پنجره خوانده می‌شود.' } })
  @IsOptional()
  @IsString()
  speed?: string;
}

/** The provider: rows live in its memory, as they would behind an HTTP API. */
const provider = new Map<string, CourierRow>(
  [
    { code: 'PST', name: 'Post', zone: 'domestic', pricePerKg: 40_000, active: true },
    { code: 'TPX', name: 'Tipax', zone: 'domestic', pricePerKg: 55_000, active: true },
    { code: 'CHP', name: 'Chapar', zone: 'regional', pricePerKg: 70_000, active: false },
    { code: 'DHL', name: 'DHL Express', zone: 'international', pricePerKg: 900_000, active: true },
  ].map((row) => [row.code, row]),
);

/**
 * Couriers come from the shipping provider, not from this app's database: an `@AdminSource`. The list, search,
 * filters, the record page, New/Save/Delete and the actions work as on any resource.
 */
@AdminSource(CourierRow, { name: 'courier', label: { en: 'Couriers', fa: 'شرکت‌های حمل' }, icon: 'truck', primaryKey: 'code', title: 'name' })
export class CourierAdmin extends AdminSourceBase<CourierRow, string> {
  list: ListConfig<CourierRow> = { columns: ['code', 'name', 'zone', 'pricePerKg', 'active'], search: ['code', 'name'], filters: ['zone', 'active'], sort: 'name' };
  form = { create: CreateCourierDto, update: UpdateCourierDto };

  async findMany(params: ListParams) {
    return inMemoryList([...provider.values()], params);
  }

  async findOne(code: string) {
    return provider.get(code) ?? null;
  }

  override async create(dto: object) {
    const input = dto as CreateCourierDto;
    const code = input.code.toUpperCase();
    if (provider.has(code)) throw new AdminFieldError({ code: 'the provider already has this code' });
    const row: CourierRow = { code, name: input.name, zone: input.zone, pricePerKg: input.pricePerKg, active: input.active ?? true };
    provider.set(code, row);
    return row;
  }

  override async update(code: string, dto: object) {
    return Object.assign(provider.get(code)!, dto as UpdateCourierDto);
  }

  override async delete(code: string) {
    provider.delete(code);
  }

  /** The quote's speed is a dropdown of the services the provider offers today (`choices`). */
  @AdminAction({ label: { en: 'Quote', fa: 'استعلام قیمت' }, input: QuoteDto, choices: { speed: 'services' } })
  async quote(row: CourierRow, input: QuoteDto): Promise<ActionOutcome> {
    const express = input.speed === 'express';
    return { message: `${row.name}: ${(row.pricePerKg * input.kg * (express ? 2 : 1)).toLocaleString('en-US')} for ${input.kg} kg${express ? ' (express)' : ''}` };
  }

  /** What the provider offers: asked when the Quote dialog opens. */
  async services() {
    return [
      { value: 'standard', label: { en: 'Standard', fa: 'عادی' } },
      { value: 'express', label: { en: 'Express (×2)', fa: 'فوری (×۲)' } },
    ];
  }
}

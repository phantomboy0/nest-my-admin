import { Module } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, Length, Matches, ValidateNested } from 'class-validator';
import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';
import { AdminResource, AdminResourceBase, type FormConfig, type ListConfig } from '../../src/index.js';

/** A composite primary key whose string part may contain the id separators. */
@Entity()
export class Line {
  @PrimaryColumn({ type: 'int' }) orderId: number;
  @PrimaryColumn({ length: 20 }) sku: string;
  @Column({ type: 'int', default: 1 }) qty: number;
}

/** A single string key, which may be "new". */
@Entity()
export class Keyed {
  @PrimaryColumn({ length: 20 }) code: string;
  @Column({ length: 40 }) label: string;
}

@AdminResource(Line)
export class LineAdmin extends AdminResourceBase<Line> {
  list: ListConfig<Line> = { columns: ['orderId', 'sku', 'qty'], sort: 'qty', pageSize: 2, filters: ['qty'] };
}

@AdminResource(Keyed)
export class KeyedAdmin extends AdminResourceBase<Keyed> {}

export class Geo {
  @Column({ type: 'decimal', precision: 8, scale: 5, nullable: true }) lat: string | null;
}

export class Address {
  @Column({ length: 40 }) city: string;
  @Column({ length: 10, nullable: true }) zip: string | null;
  @Column(() => Geo) geo: Geo;
}

/** An embedded (with a nested embedded) and a json column edited as a list of sub-forms through the DTO. */
@Entity()
export class Venue {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) name: string;
  @Column(() => Address) address: Address;
  @Column({ type: 'simple-json', nullable: true }) hours: Array<{ day: string; opens: string; note?: string }> | null;
}

export class AddressDto {
  @IsString() @Length(2, 40) city: string;
  @IsOptional() @Matches(/^\d{5}$/, { message: 'zip must be 5 digits' }) zip?: string | null;
}

export class OpeningDto {
  @IsIn(['mon', 'tue', 'wed']) day: string;
  @Matches(/^\d{2}:\d{2}$/) opens: string;
}

export class VenueDto {
  @IsString() @Length(1, 40) name: string;
  @ValidateNested() @Type(() => AddressDto) address: AddressDto;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OpeningDto) hours?: OpeningDto[] | null;
}

@AdminResource(Venue)
export class VenueAdmin extends AdminResourceBase<Venue> {
  list: ListConfig<Venue> = { columns: ['name', 'address.city'], filters: ['address.city'], search: ['name', 'address.city'] };
}

@AdminResource(Venue, { name: 'venue-dto' })
export class VenueDtoAdmin extends AdminResourceBase<Venue> {
  form: FormConfig = { create: VenueDto };
}

@Module({ providers: [LineAdmin, KeyedAdmin, VenueAdmin, VenueDtoAdmin] })
export class ShapesModule {}

export const SHAPE_ENTITIES: Function[] = [Line, Keyed, Venue];

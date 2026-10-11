import { Column, Entity, PrimaryColumn } from 'typeorm';

/** One row per setting of the shop: its name and its value as JSON. */
@Entity('shop_setting')
export class ShopSetting {
  @PrimaryColumn({ length: 60 }) name: string;
  @Column({ type: 'text' }) value: string;
}

import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** An admin-wide setting the admin keeps for itself (the accent colour), by key. */
@Entity('nma_setting')
export class NmaSetting {
  @PrimaryColumn({ type: 'varchar', length: 80 }) key: string;
  @Column({ type: 'simple-json' }) value: unknown;
  @UpdateDateColumn() updatedAt: Date;
}

/** Add to the entities of the `appearance` DataSource. */
export const ADMIN_SETTING_ENTITIES = [NmaSetting];

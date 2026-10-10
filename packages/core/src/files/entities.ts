import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * An uploaded file. `temp` rows belong to an upload nobody has saved a record for yet (cleaned up after 24 hours);
 * `attached` rows belong to `recordId` of `resource`.`field`.
 */
@Entity('nma_file')
@Index(['status', 'createdAt'])
export class NmaFile {
  /** The upload token while `temp`. */
  @PrimaryColumn({ type: 'varchar', length: 36 }) id: string;
  /** `<resource>/<field>/<yyyy>/<mm>/<uuid><ext>` */
  @Column({ type: 'varchar', length: 500, unique: true }) key: string;
  /** The original file name, cleaned. */
  @Column({ type: 'varchar', length: 255 }) name: string;
  @Column({ type: 'varchar', length: 150 }) contentType: string;
  @Column({ type: 'int' }) size: number;
  @Column({ type: 'varchar', length: 10 }) visibility: 'public' | 'private';
  @Column({ type: 'varchar', length: 10 }) status: 'temp' | 'attached';
  @Column({ type: 'varchar', length: 100 }) resource: string;
  @Column({ type: 'varchar', length: 100 }) field: string;
  /** Null while `temp`. */
  @Column({ type: 'varchar', length: 255, nullable: true }) recordId: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) createdBy: string | null;
  @CreateDateColumn() createdAt: Date;
}

/** Add these to the TypeORM entities of the DataSource named in `forRoot({ files })`. */
export const ADMIN_FILE_ENTITIES = [NmaFile];

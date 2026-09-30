import { Column, CreateDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { LocalizedText } from '../i18n/localized-text.js';
import type { RoleDefinition } from '../policy/roles.js';

/** A role (spec §6.1). `system` roles come from `forRoot({ roles })`: synced at boot, read-only in the admin. */
@Entity('nma_role')
export class NmaRole {
  @PrimaryColumn({ type: 'varchar', length: 100 }) name: string;
  @Column({ type: 'simple-json', nullable: true }) label: LocalizedText | null;
  @Column({ type: 'simple-json', nullable: true }) description: LocalizedText | null;
  @Column({ default: false }) system: boolean;
  /** Permissions, field rules and scopes. */
  @Column({ type: 'simple-json' }) definition: Pick<RoleDefinition, 'permissions' | 'fields' | 'scopes'>;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

/** A set of users that holds roles. */
@Entity('nma_group')
export class NmaGroup {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar', length: 100, unique: true }) name: string;
  @Column({ type: 'simple-json', nullable: true }) label: LocalizedText | null;
  @CreateDateColumn() createdAt: Date;
}

@Entity('nma_group_role')
export class NmaGroupRole {
  @PrimaryColumn({ type: 'int' }) groupId: number;
  @PrimaryColumn({ type: 'varchar', length: 100 }) roleName: string;
}

/** User ids are strings: the users themselves belong to the auth adapter. */
@Entity('nma_group_member')
export class NmaGroupMember {
  @PrimaryColumn({ type: 'int' }) groupId: number;
  @PrimaryColumn({ type: 'varchar', length: 100 }) userId: string;
}

@Entity('nma_user_role')
export class NmaUserRole {
  @PrimaryColumn({ type: 'varchar', length: 100 }) userId: string;
  @PrimaryColumn({ type: 'varchar', length: 100 }) roleName: string;
}

/** Add these to the TypeORM entities of the DataSource named in `forRoot({ rbac })`. */
export const ADMIN_RBAC_ENTITIES = [NmaRole, NmaGroup, NmaGroupRole, NmaGroupMember, NmaUserRole];

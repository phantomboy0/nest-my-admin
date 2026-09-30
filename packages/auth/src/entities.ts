import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

/** An admin user (spec §7). Usernames are stored lower-case. */
@Entity('nma_user')
export class NmaUser {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 150, unique: true }) username: string;
  @Column({ type: 'varchar', length: 254, nullable: true }) email: string | null;
  @Column({ length: 150 }) displayName: string;
  /** `scrypt$N$r$p$salt$hash`; never sent anywhere. */
  @Column({ length: 255 }) passwordHash: string;
  @Column({ default: false }) isSuperuser: boolean;
  /** Inactive users cannot sign in, and their sessions stop working. */
  @Column({ default: true }) isActive: boolean;
  @Column({ type: 'int', default: 0 }) failedLogins: number;
  @Column({ type: Date, nullable: true }) lockedUntil: Date | null;
  @Column({ type: Date, nullable: true }) lastLoginAt: Date | null;
  @CreateDateColumn() createdAt: Date;
}

/** A signed-in browser. Only the SHA-256 of the session token is stored. */
@Entity('nma_session')
@Index(['userId'])
export class NmaSession {
  /** Public id (the account page shows and revokes sessions by it); unrelated to the token. */
  @PrimaryColumn({ type: 'varchar', length: 32 }) id: string;
  @Column({ type: 'varchar', length: 64, unique: true }) tokenHash: string;
  @Column({ type: 'int' }) userId: number;
  @ManyToOne(() => NmaUser, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'userId' }) user: NmaUser;
  @Column({ type: 'varchar', length: 64 }) csrfToken: string;
  @Column({ type: Date }) createdAt: Date;
  @Column({ type: Date }) lastSeenAt: Date;
  /** The absolute limit; the idle limit is `lastSeenAt` + the idle timeout. */
  @Column({ type: Date }) expiresAt: Date;
  @Column({ type: 'varchar', length: 300, nullable: true }) userAgent: string | null;
  @Column({ type: 'varchar', length: 64, nullable: true }) ip: string | null;
}

/** Add these to the TypeORM entities of the DataSource the built-in auth uses. */
export const ADMIN_AUTH_ENTITIES = [NmaUser, NmaSession];

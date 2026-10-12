import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Employee {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 120 }) name: string;
  @Column({ length: 80 }) position: string;
  /** Sensitive in the admin: the audit log records that it changed, never what it was or became. */
  @Column({ type: 'decimal', precision: 12, scale: 2 }) salary: string;
  @Column({ type: 'date', nullable: true }) hiredOn: string | null;
  @CreateDateColumn() createdAt: Date;
}

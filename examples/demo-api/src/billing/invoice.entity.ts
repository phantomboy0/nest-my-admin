import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Invoice {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40, unique: true }) number: string;
  @Column({ length: 120 }) customer: string;
  @Column({ type: 'decimal', precision: 12, scale: 2 }) total: string;
  /** The storage key of the invoice's PDF: private, so only people who may view the invoice can download it. */
  @Column({ type: 'varchar', length: 500, nullable: true }) pdf: string | null;
  @CreateDateColumn() createdAt: Date;
}

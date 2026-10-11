import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Article {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 160 }) title: string;
  /** HTML from the rich-text editor; the admin sanitizes it on every write. */
  @Column({ type: 'text' }) body: string;
  @CreateDateColumn() createdAt: Date;
}

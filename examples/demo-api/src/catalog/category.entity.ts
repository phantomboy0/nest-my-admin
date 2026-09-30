import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Category {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 60, unique: true }) name: string;
}

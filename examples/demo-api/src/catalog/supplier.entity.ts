import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Embedded in Supplier: edited as a group of fields in the supplier form. */
export class Contact {
  @Column({ length: 120, nullable: true }) email: string | null;
  @Column({ length: 30, nullable: true }) phone: string | null;
}

@Entity()
export class Supplier {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 80 }) name: string;
  @Column(() => Contact) contact: Contact;
}

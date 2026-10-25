import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Allowlisted back-office account. There is no public registration — rows are
 * created via bootstrap env vars, an authenticated admin endpoint, or the
 * `admin:create-user` script.
 */
@Entity('admin_user')
export class AdminUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  email: string;

  @Column({ type: 'varchar' })
  passwordHash: string;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  disabledAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

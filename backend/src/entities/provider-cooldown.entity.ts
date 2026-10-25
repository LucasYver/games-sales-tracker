import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Cross-invocation cooldown for external providers (e.g. Perplexity out of
 * credits). Survives serverless cold starts so a dead key is not re-probed on
 * every harvest game / cron tick.
 */
@Entity('provider_cooldown')
export class ProviderCooldown {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  provider: string;

  @Column({ type: 'timestamptz' })
  disabledUntil: Date;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

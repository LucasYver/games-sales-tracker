import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Records every feed article URL we have already processed, so the continuous
// RSS monitor never re-runs the (paid) LLM extraction on the same article —
// including articles that yielded no sales figure.
@Entity('processed_article')
export class ProcessedArticle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar' })
  url: string;

  @Column({ type: 'uuid', nullable: true })
  matchedGameId: string | null;

  @Column({ type: 'boolean', default: false })
  hadFigure: boolean;

  @CreateDateColumn()
  processedAt: Date;
}

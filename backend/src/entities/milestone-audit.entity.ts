import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Platform } from './enums';
import { Milestone } from './milestone.entity';

// Verdict produced by the audit engine for a single milestone.
//  - OK: the stored figure is a valid cumulative lifetime units total, on the
//    right platform, with a sane date — nothing to do.
//  - FIX: the figure is real but at least one field is wrong (platform / date /
//    units / engagement flag). The corrected value is in the `proposed*` cols.
//  - REJECT: the figure should not be a milestone at all (periodic, revenue,
//    engagement, franchise total, or about a different game).
export enum AuditVerdict {
  OK = 'OK',
  FIX = 'FIX',
  REJECT = 'REJECT',
}

// Lifecycle of an audit finding. In phase 1 every row is PENDING (report only).
// Later phases flip rows to AUTO_APPLIED (engine wrote the fix/rejection),
// APPLIED (operator accepted from the review queue) or DISMISSED (operator
// judged the finding a false positive).
export enum AuditStatus {
  PENDING = 'PENDING',
  AUTO_APPLIED = 'AUTO_APPLIED',
  APPLIED = 'APPLIED',
  DISMISSED = 'DISMISSED',
}

// One audit verdict per milestone (upserted). Keeps a persistent trail so the
// batch can run incrementally (re-audit only what changed, matched by
// `fingerprint`) and so a future review queue can surface the pending findings.
@Entity('milestone_audit')
@Index(['milestoneId'], { unique: true })
@Index(['verdict'])
@Index(['status'])
export class MilestoneAudit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  milestoneId: string;

  @Column('uuid')
  gameId: string;

  @Column({ type: 'enum', enum: AuditVerdict })
  verdict: AuditVerdict;

  // 0–100 confidence in the verdict. Drives the auto-apply thresholds in later
  // phases; informational in phase 1.
  @Column('int')
  confidence: number;

  // Proposed corrections, populated only for a FIX verdict and only for the
  // fields that actually diverge from the stored milestone.
  @Column({ type: 'enum', enum: Platform, nullable: true })
  proposedPlatform: Platform | null;

  @Column({ type: 'timestamptz', nullable: true })
  proposedReportedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  proposedUnits: number | null;

  @Column({ type: 'boolean', nullable: true })
  proposedIsEngagement: boolean | null;

  // Deterministic rule identifiers that fired (e.g. PERIODIC_QUOTE,
  // PLATFORM_QUOTE_MISMATCH). Free-form human-readable explanations.
  @Column({ type: 'jsonb', nullable: true })
  ruleFlags: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  reasons: string[] | null;

  @Column({ type: 'enum', enum: AuditStatus, default: AuditStatus.PENDING })
  status: AuditStatus;

  @Column({ type: 'boolean', default: false })
  llmUsed: boolean;

  // Hash of the audited milestone fields (units/platform/date/note/source/…).
  // Used to skip re-auditing unchanged rows on incremental runs.
  @Column({ type: 'varchar' })
  fingerprint: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  auditedAt: Date;

  @ManyToOne(() => Milestone, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'milestoneId' })
  milestone: Milestone;
}

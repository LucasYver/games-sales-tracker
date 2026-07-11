import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Game } from '../entities/game.entity';
import { Milestone } from '../entities/milestone.entity';
import {
  AuditStatus,
  AuditVerdict,
  MilestoneAudit,
} from '../entities/milestone-audit.entity';
import { Platform, SalesSource } from '../entities/enums';
import { LlmExtractorService } from '../llm/llm-extractor.service';

// Synthetic proxy sources: injected deliberately, their `note` documents the
// methodology rather than being a press quote, so they are excluded from
// auditing (the model would always misread "players" as engagement).
const LEAK_SOURCES = new Set<SalesSource>([
  SalesSource.STEAM_LEAK,
  SalesSource.PLAYSTATION_LEAK,
]);

// A stored `reportedAt` is only re-proposed when the LLM-implied date differs
// by more than this many days (or when the milestone is undated).
const DATE_DRIFT_DAYS = 45;

// Units are only re-proposed on a clear order-of-magnitude discrepancy — never
// on rounding differences ("over 2M" stored as an exact 2,000,000).
const UNITS_LOW_RATIO = 0.5;
const UNITS_HIGH_RATIO = 2.0;

// Minimum LLM confidence to turn a divergence into a concrete FIX proposal.
const MIN_LLM_FIX_CONFIDENCE = 60;

export interface AuditOptions {
  gameId?: string;
  limit?: number;
  incremental?: boolean;
  persist?: boolean;
  onProgress?: (done: number, total: number) => void;
}

export interface AuditFinding {
  milestoneId: string;
  gameId: string;
  gameName: string;
  verdict: AuditVerdict;
  confidence: number;
  current: {
    units: number;
    platform: Platform;
    reportedAt: string | null;
    source: string;
    isEngagement: boolean;
    note: string | null;
    sourceUrl: string | null;
  };
  proposed: {
    platform?: Platform;
    reportedAt?: string | null;
    units?: number;
    isEngagement?: boolean;
  };
  reasons: string[];
  llmUsed: boolean;
}

export interface AuditRunResult {
  findings: AuditFinding[];
  scanned: number;
  skipped: number;
  totalActive: number;
}

interface LlmVerdict {
  isValidCumulativeLifetimeUnits: boolean;
  rejectionReason: string | null;
  platform: string | null;
  isEngagement: boolean;
  units: number | null;
  reportedAt: string | null;
  confidence: number;
  reason: string;
}

const LLM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    isValidCumulativeLifetimeUnits: {
      type: 'boolean',
      description:
        'True only if the quote states a CUMULATIVE LIFETIME copies/units SOLD (or shipped) total for THIS specific game. A total stated "as of <date>", "by <date>", "to date", "cumulative" or "has sold X" is VALID. False for periodic-window figures, revenue/$ figures, engagement metrics, or multi-game franchise/series totals.',
    },
    rejectionReason: {
      type: ['string', 'null'],
      enum: [
        'periodic',
        'revenue',
        'engagement',
        'franchise',
        'wrong_game',
        'not_sales',
        'other',
        null,
      ],
      description: 'Why the figure is invalid; null when it is valid.',
    },
    platform: {
      type: ['string', 'null'],
      enum: [
        'GLOBAL',
        'PC',
        'PLAYSTATION',
        'XBOX',
        'SWITCH',
        'MOBILE',
        'OTHER',
        null,
      ],
      description:
        'Platform scope implied by the quote. GLOBAL = worldwide / all platforms combined. Use a single platform only when the quote clearly scopes the figure to it (e.g. "on Steam" -> PC, "on PS5" -> PLAYSTATION).',
    },
    isEngagement: {
      type: 'boolean',
      description:
        'True if the figure counts players/downloads/active users rather than copies sold.',
    },
    units: {
      type: ['number', 'null'],
      description:
        'The absolute unit count stated in the quote. Beware locale formatting: "2 million" -> 2000000, and a European thousands separator like "100.000" or "400.000" -> 100000 / 400000. Null if the quote states no count.',
    },
    reportedAt: {
      type: ['string', 'null'],
      description:
        'ISO date (YYYY-MM-DD) the figure refers to, taken ONLY from the quote. Null if the quote carries no date.',
    },
    confidence: {
      type: 'number',
      description: 'Confidence 0-100 in this assessment.',
    },
    reason: {
      type: 'string',
      description: 'One short sentence grounded in the quote wording.',
    },
  },
  required: [
    'isValidCumulativeLifetimeUnits',
    'rejectionReason',
    'platform',
    'isEngagement',
    'units',
    'reportedAt',
    'confidence',
    'reason',
  ],
} satisfies Record<string, unknown>;

@Injectable()
export class MilestoneAuditService {
  private readonly logger = new Logger(MilestoneAuditService.name);

  constructor(
    @InjectRepository(Milestone)
    private readonly milestones: Repository<Milestone>,
    @InjectRepository(Game)
    private readonly games: Repository<Game>,
    @InjectRepository(MilestoneAudit)
    private readonly audits: Repository<MilestoneAudit>,
    private readonly llm: LlmExtractorService,
  ) {}

  async audit(opts: AuditOptions = {}): Promise<AuditRunResult> {
    const incremental = opts.incremental ?? true;
    const persist = opts.persist ?? true;

    const qb = this.milestones
      .createQueryBuilder('m')
      .innerJoinAndSelect('m.game', 'g')
      .where('m.rejectedAt IS NULL')
      .andWhere('g.deletedAt IS NULL')
      .orderBy('m.gameId', 'ASC')
      .addOrderBy('m.reportedAt', 'ASC');
    if (opts.gameId) qb.andWhere('m.gameId = :gid', { gid: opts.gameId });
    const active = await qb.getMany();
    const totalActive = active.length;

    const existingAudits = incremental
      ? new Map(
          (
            await this.audits.find({
              where: opts.gameId ? { gameId: opts.gameId } : {},
            })
          ).map((a) => [a.milestoneId, a]),
        )
      : new Map<string, MilestoneAudit>();

    const toProcess: Milestone[] = [];
    let skipped = 0;
    for (const m of active) {
      const prev = existingAudits.get(m.id);
      if (incremental && prev && prev.fingerprint === fingerprintOf(m)) {
        skipped++;
        continue;
      }
      toProcess.push(m);
    }
    const capped =
      opts.limit && opts.limit > 0 ? toProcess.slice(0, opts.limit) : toProcess;

    const findings: AuditFinding[] = [];
    let done = 0;
    for (const milestone of capped) {
      const finding = await this.auditOne(milestone, milestone.game);
      findings.push(finding);
      if (persist) await this.persist(milestone, finding);
      done++;
      opts.onProgress?.(done, capped.length);
    }

    return { findings, scanned: capped.length, skipped, totalActive };
  }

  private async auditOne(
    milestone: Milestone,
    game: Game,
  ): Promise<AuditFinding> {
    if (LEAK_SOURCES.has(milestone.source)) {
      return this.finding(milestone, AuditVerdict.OK, 50, {}, [
        'Leak-derived milestone; excluded from audit.',
      ]);
    }
    if (!this.llm.enabled) {
      return this.finding(milestone, AuditVerdict.OK, 50, {}, [
        'LLM disabled (no OPENAI_API_KEY); milestone not audited.',
      ]);
    }
    const note = (milestone.note ?? '').trim();
    if (!note) {
      return this.finding(milestone, AuditVerdict.OK, 50, {}, [
        'No quote to audit against.',
      ]);
    }

    const llm = await this.runLlmCritic(milestone, game);
    if (!llm) {
      return this.finding(milestone, AuditVerdict.OK, 50, {}, [
        'LLM returned no verdict; milestone not audited.',
      ]);
    }

    return this.combine(milestone, llm);
  }

  private combine(milestone: Milestone, llm: LlmVerdict): AuditFinding {
    const confidence = clampScore(llm.confidence);

    if (!llm.isValidCumulativeLifetimeUnits) {
      return this.finding(
        milestone,
        AuditVerdict.REJECT,
        confidence,
        {},
        [
          `Not a valid lifetime units figure (${llm.rejectionReason ?? 'other'}) — ${llm.reason}`,
        ],
        true,
      );
    }

    const proposed: AuditFinding['proposed'] = {};
    const reasons: string[] = [];

    if (llm.confidence >= MIN_LLM_FIX_CONFIDENCE) {
      const llmPlatform = normalizePlatform(llm.platform);
      if (
        llmPlatform &&
        llmPlatform !== milestone.platform &&
        !milestone.isEngagement
      ) {
        proposed.platform = llmPlatform;
        reasons.push(
          `Platform should be ${llmPlatform} (was ${milestone.platform}).`,
        );
      }
      if (llm.isEngagement !== milestone.isEngagement) {
        proposed.isEngagement = llm.isEngagement;
        reasons.push(
          `isEngagement should be ${llm.isEngagement} (was ${milestone.isEngagement}).`,
        );
      }
      const llmDate = parseIsoDate(llm.reportedAt);
      if (
        llmDate &&
        (!milestone.reportedAt ||
          !datesWithinDays(llmDate, milestone.reportedAt, DATE_DRIFT_DAYS))
      ) {
        proposed.reportedAt = llmDate.toISOString();
        reasons.push(
          `Date should be ${llmDate.toISOString().slice(0, 10)} (was ${milestone.reportedAt?.toISOString().slice(0, 10) ?? 'none'}).`,
        );
      }
      if (
        llm.units !== null &&
        llm.units > 0 &&
        milestone.units > 0 &&
        (llm.units / milestone.units > UNITS_HIGH_RATIO ||
          llm.units / milestone.units < UNITS_LOW_RATIO)
      ) {
        proposed.units = Math.round(llm.units);
        reasons.push(
          `Units should be ~${formatUnits(llm.units)} (was ${formatUnits(milestone.units)}).`,
        );
      }
    }

    const verdict =
      Object.keys(proposed).length > 0 ? AuditVerdict.FIX : AuditVerdict.OK;
    if (verdict === AuditVerdict.OK) reasons.push('Milestone looks correct.');

    return this.finding(
      milestone,
      verdict,
      confidence,
      proposed,
      reasons,
      true,
    );
  }

  private finding(
    milestone: Milestone,
    verdict: AuditVerdict,
    confidence: number,
    proposed: AuditFinding['proposed'],
    reasons: string[],
    llmUsed = false,
  ): AuditFinding {
    return {
      milestoneId: milestone.id,
      gameId: milestone.gameId,
      gameName: milestone.game?.name ?? '',
      verdict,
      confidence,
      current: {
        units: milestone.units,
        platform: milestone.platform,
        reportedAt: milestone.reportedAt?.toISOString() ?? null,
        source: milestone.source,
        isEngagement: milestone.isEngagement,
        note: milestone.note,
        sourceUrl: milestone.sourceUrl,
      },
      proposed,
      reasons,
      llmUsed,
    };
  }

  private async runLlmCritic(
    milestone: Milestone,
    game: Game,
  ): Promise<LlmVerdict | null> {
    const system =
      'You audit a single sales milestone stored in a database. You are given ' +
      'the game and the verbatim quote the figure was extracted from. Judge ' +
      'STRICTLY from the quote text — never use outside knowledge.\n\n' +
      'The note may mix the ORIGINAL quoted figure (usually inside nested ' +
      "quotation marks) with the operator's own annotations. Base your verdict " +
      'on the original quoted figure; treat annotations (e.g. "launch-scoped", ' +
      '"predates the PC release") as secondary context, not as a reason to ' +
      'reject a figure the quote itself states as a worldwide/cumulative total.\n\n' +
      'A VALID milestone is a cumulative lifetime copies/units SOLD (or ' +
      'shipped) total for THIS specific game.\n' +
      '- "as of <date>", "by <date>", "to date", "cumulative", "lifetime", ' +
      '"has sold/shipped X", "total shipments", "shipments and digital sales", ' +
      '"units shipped" are VALID: they are cumulative sell-in/sell-through ' +
      'totals, normally stated as-of a date. Do NOT reject these as periodic.\n' +
      '- A total measured at or around a launch ("as of launch", ' +
      '"launch-scoped", "at launch") is STILL a cumulative total. Reject as ' +
      '"periodic" ONLY when the figure explicitly counts sales DURING a bounded ' +
      "WINDOW: first day/week/weekend/month, opening sales, a named month's " +
      'sales, a specific quarter (Q1-Q4) or a fiscal year (FY).\n' +
      '- Reject as "revenue" when the figure is money ($/€/£/¥), not a unit ' +
      'count.\n' +
      '- Reject as "engagement" when it counts players/downloads/installs/' +
      'active users/subscribers rather than copies sold.\n' +
      '- Reject as "franchise" ONLY when the quote explicitly sums MULTIPLE ' +
      "different games or a whole series. A single game's worldwide or " +
      'shipment total is NOT franchise. A regional total (e.g. "across Europe ' +
      'and North America") is STILL this game — treat it as valid and note the ' +
      'region in the reason.\n' +
      '- Reject as "wrong_game" when the quote is clearly about a different ' +
      'title.\n\n' +
      'Also determine the platform scope, unit count and date implied by the ' +
      'quote.';

    const user = [
      `Game: ${game.name}`,
      `Game release date: ${game.releaseDate?.toISOString().slice(0, 10) ?? 'unknown'}`,
      `Game platforms: ${(game.platforms ?? []).join(', ') || 'unknown'}`,
      '',
      'Stored milestone:',
      `- units: ${milestone.units}`,
      `- platform: ${milestone.platform}`,
      `- reportedAt: ${milestone.reportedAt?.toISOString().slice(0, 10) ?? 'none'}`,
      `- source: ${milestone.source}`,
      `- isEngagement: ${milestone.isEngagement}`,
      `- sourceUrl: ${milestone.sourceUrl ?? 'none'}`,
      '',
      `Verbatim quote:\n"""${milestone.note ?? ''}"""`,
    ].join('\n');

    return this.llm.extract<LlmVerdict>({
      system,
      user,
      schemaName: 'milestone_audit_verdict',
      schema: LLM_SCHEMA,
    });
  }

  private async persist(
    milestone: Milestone,
    finding: AuditFinding,
  ): Promise<void> {
    const existing = await this.audits.findOne({
      where: { milestoneId: milestone.id },
    });
    const row =
      existing ??
      this.audits.create({
        milestoneId: milestone.id,
        gameId: milestone.gameId,
      });

    row.gameId = milestone.gameId;
    row.verdict = finding.verdict;
    row.confidence = finding.confidence;
    row.proposedPlatform = finding.proposed.platform ?? null;
    row.proposedReportedAt = finding.proposed.reportedAt
      ? new Date(finding.proposed.reportedAt)
      : null;
    row.proposedUnits = finding.proposed.units ?? null;
    row.proposedIsEngagement = finding.proposed.isEngagement ?? null;
    row.ruleFlags = [];
    row.reasons = finding.reasons;
    row.llmUsed = finding.llmUsed;
    row.fingerprint = fingerprintOf(milestone);
    // A fresh finding always returns to the review queue; a human decision
    // (APPLIED/DISMISSED) is only meaningful for the version it was made on.
    row.status = AuditStatus.PENDING;

    await this.audits.save(row);
  }
}

export function fingerprintOf(m: Milestone): string {
  const payload = [
    m.units,
    m.platform,
    m.reportedAt ? m.reportedAt.getTime() : '',
    m.source,
    m.isEngagement ? 1 : 0,
    m.note ?? '',
  ].join('|');
  return createHash('sha1').update(payload).digest('hex');
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function parseIsoDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function datesWithinDays(
  a: Date | null,
  b: Date | null,
  days: number,
): boolean {
  if (!a || !b) return false;
  return Math.abs(a.getTime() - b.getTime()) <= days * 24 * 3600 * 1000;
}

function normalizePlatform(value: string | null): Platform | null {
  if (!value) return null;
  const upper = value.toUpperCase();
  if (!(upper in Platform)) return null;
  return (Platform as Record<string, Platform>)[upper];
}

function formatUnits(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return `${Math.round(n)}`;
}

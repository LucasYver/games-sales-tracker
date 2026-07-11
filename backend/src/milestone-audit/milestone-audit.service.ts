import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Game } from '../entities/game.entity';
import { Milestone } from '../entities/milestone.entity';
import {
  AuditStatus,
  AuditVerdict,
  MilestoneAudit,
} from '../entities/milestone-audit.entity';
import { Platform } from '../entities/enums';
import { LlmExtractorService } from '../llm/llm-extractor.service';
import { isPeriodicQuote } from '../ingestion/sales-figure.utils';

// A per-platform figure must not exceed the GLOBAL total by more than this
// slack before it is flagged as inconsistent (mirrors the ingestion guard).
const CROSS_PLATFORM_SLACK = 1.15;

// Two figures for the same (game, platform) scope are treated as near
// duplicates when their units are within this ratio of each other AND their
// dates are within DUPLICATE_DATE_DAYS.
const DUPLICATE_UNITS_RATIO = 0.05;
const DUPLICATE_DATE_DAYS = 120;

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
  useLlm?: boolean;
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
  ruleFlags: string[];
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
        'True only if the quote states a CUMULATIVE LIFETIME copies/units-sold total for THIS EXACT game. False for periodic (first-week/quarter/fiscal) figures, revenue/$ figures, engagement metrics (players, downloads, active users, subscribers), franchise/series totals, or a different game.',
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
        'The absolute unit count stated in the quote (e.g. "2 million" -> 2000000). Null if the quote states no count.',
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
} as const;

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
    const useLlm = opts.useLlm ?? true;
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

    // Sibling context per game (cross-platform overflow + duplicate checks).
    const byGame = new Map<string, Milestone[]>();
    for (const m of active) {
      const arr = byGame.get(m.gameId) ?? [];
      arr.push(m);
      byGame.set(m.gameId, arr);
    }

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
      const game = milestone.game;
      const siblings = byGame.get(milestone.gameId) ?? [];
      const finding = await this.auditOne(milestone, game, siblings, useLlm);
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
    siblings: Milestone[],
    useLlm: boolean,
  ): Promise<AuditFinding> {
    const ruleFlags: string[] = [];
    const reasons: string[] = [];

    const note = milestone.note ?? '';

    if (note && isPeriodicQuote(note)) {
      ruleFlags.push('PERIODIC_QUOTE');
      reasons.push('Quote matches a periodic/revenue/engagement pattern.');
    }
    if (!milestone.reportedAt) {
      ruleFlags.push('UNDATED');
      reasons.push('Milestone has no reportedAt date.');
    } else if (
      game.releaseDate &&
      milestone.reportedAt.getTime() < game.releaseDate.getTime()
    ) {
      ruleFlags.push('PRE_RELEASE');
      reasons.push('Reported date is before the game release date.');
    }

    const quoteUnits = parseUnitsFromQuote(note);
    if (
      quoteUnits !== null &&
      milestone.units > 0 &&
      (quoteUnits / milestone.units > UNITS_HIGH_RATIO ||
        quoteUnits / milestone.units < UNITS_LOW_RATIO)
    ) {
      ruleFlags.push('UNITS_QUOTE_MISMATCH');
      reasons.push(
        `Quote implies ~${formatUnits(quoteUnits)} but stored units are ${formatUnits(milestone.units)}.`,
      );
    }

    const scope = classifyPlatformScope(note);
    if (
      scope.platform &&
      scope.confidence === 'high' &&
      scope.platform !== milestone.platform &&
      !milestone.isEngagement
    ) {
      ruleFlags.push('PLATFORM_QUOTE_MISMATCH');
      reasons.push(
        `Quote scopes to ${scope.platform} but stored platform is ${milestone.platform}.`,
      );
    }

    // Cross-platform overflow: a per-platform figure larger than the GLOBAL
    // total of the same game (both dated within a year of each other).
    if (milestone.platform !== Platform.GLOBAL && !milestone.isEngagement) {
      const globalMax = Math.max(
        0,
        ...siblings
          .filter((s) => s.platform === Platform.GLOBAL && !s.isEngagement)
          .map((s) => s.units),
      );
      if (globalMax > 0 && milestone.units > globalMax * CROSS_PLATFORM_SLACK) {
        ruleFlags.push('EXCEEDS_GLOBAL');
        reasons.push(
          `Per-platform units (${formatUnits(milestone.units)}) exceed the game's GLOBAL total (${formatUnits(globalMax)}).`,
        );
      }
    }

    // Duplicate: another active figure with the same scope, near-identical
    // units and a close date. We flag the OLDER-captured one as the duplicate.
    const dup = siblings.find(
      (s) =>
        s.id !== milestone.id &&
        s.platform === milestone.platform &&
        s.isEngagement === milestone.isEngagement &&
        Math.abs(s.units - milestone.units) <=
          milestone.units * DUPLICATE_UNITS_RATIO &&
        datesWithinDays(s.reportedAt, milestone.reportedAt, DUPLICATE_DATE_DAYS) &&
        s.capturedAt.getTime() < milestone.capturedAt.getTime(),
    );
    if (dup) {
      ruleFlags.push('DUPLICATE');
      reasons.push(
        `Near-duplicate of an earlier ${milestone.platform} figure (${formatUnits(milestone.units)}).`,
      );
    }

    let llm: LlmVerdict | null = null;
    let llmUsed = false;
    if (useLlm && this.llm.enabled && note.trim().length > 0) {
      llm = await this.runLlmCritic(milestone, game);
      llmUsed = llm !== null;
    }

    return this.combine(milestone, ruleFlags, reasons, llm, llmUsed);
  }

  private combine(
    milestone: Milestone,
    ruleFlags: string[],
    reasons: string[],
    llm: LlmVerdict | null,
    llmUsed: boolean,
  ): AuditFinding {
    const proposed: AuditFinding['proposed'] = {};
    let verdict: AuditVerdict = AuditVerdict.OK;
    let confidence = 50;

    if (llm && !llm.isValidCumulativeLifetimeUnits) {
      verdict = AuditVerdict.REJECT;
      confidence = clampScore(llm.confidence);
      reasons.push(
        `LLM: not a valid lifetime units figure (${llm.rejectionReason ?? 'other'}) — ${llm.reason}`,
      );
    } else if (ruleFlags.includes('PERIODIC_QUOTE') && !llm) {
      verdict = AuditVerdict.REJECT;
      confidence = 70;
    } else if (ruleFlags.includes('DUPLICATE')) {
      verdict = AuditVerdict.REJECT;
      confidence = Math.max(confidence, 65);
    } else {
      if (llm && llm.confidence >= MIN_LLM_FIX_CONFIDENCE) {
        const llmPlatform = normalizePlatform(llm.platform);
        if (
          llmPlatform &&
          llmPlatform !== milestone.platform &&
          !milestone.isEngagement
        ) {
          proposed.platform = llmPlatform;
          reasons.push(
            `LLM: platform should be ${llmPlatform} (was ${milestone.platform}).`,
          );
        }
        if (llm.isEngagement !== milestone.isEngagement) {
          proposed.isEngagement = llm.isEngagement;
          reasons.push(
            `LLM: isEngagement should be ${llm.isEngagement} (was ${milestone.isEngagement}).`,
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
            `LLM: date should be ${llmDate.toISOString().slice(0, 10)} (was ${milestone.reportedAt?.toISOString().slice(0, 10) ?? 'none'}).`,
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
            `LLM: units should be ~${formatUnits(llm.units)} (was ${formatUnits(milestone.units)}).`,
          );
        }
      }

      if (Object.keys(proposed).length > 0) {
        verdict = AuditVerdict.FIX;
        confidence = llm ? clampScore(llm.confidence) : 55;
      } else if (ruleFlags.length > 0) {
        // No concrete correction to propose, but a deterministic rule fired
        // (undated, pre-release, exceeds-global…): surface it for review
        // rather than silently marking it OK.
        verdict = AuditVerdict.FIX;
        confidence = llm ? clampScore(llm.confidence) : 50;
      } else {
        verdict = AuditVerdict.OK;
        confidence = llm ? clampScore(llm.confidence) : 50;
      }
    }

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
      ruleFlags,
      reasons,
      llmUsed,
    };
  }

  private async runLlmCritic(
    milestone: Milestone,
    game: Game,
  ): Promise<LlmVerdict | null> {
    const system =
      'You audit a single sales milestone already stored in a database. ' +
      'You are given the game and the verbatim quote the figure was extracted ' +
      'from. Judge STRICTLY from the quote text — never use outside knowledge. ' +
      'A valid milestone is a CUMULATIVE LIFETIME copies/units-sold total for ' +
      'THIS EXACT game. Reject periodic figures (first-week, weekend, monthly, ' +
      'quarter, fiscal-year windows), revenue/$ figures, engagement metrics ' +
      '(players, downloads, active users, subscribers), franchise/series ' +
      'totals, and figures about a different game. Determine the platform scope, ' +
      'unit count and date implied by the quote.';

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
      schema: LLM_SCHEMA as unknown as Record<string, unknown>,
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
    row.ruleFlags = finding.ruleFlags;
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
  return (Object.values(Platform) as string[]).includes(upper)
    ? (upper as Platform)
    : null;
}

const SCALE_WORDS: Record<string, number> = {
  thousand: 1e3,
  k: 1e3,
  million: 1e6,
  m: 1e6,
  billion: 1e9,
  bn: 1e9,
  b: 1e9,
};

// Best-effort extraction of the units figure a quote is asserting. Prefers a
// count adjacent to "copies/units/sold/sales"; falls back to the first
// number+scale token. Returns null when nothing plausible is found.
export function parseUnitsFromQuote(quote: string): number | null {
  if (!quote) return null;
  const re =
    /(\d[\d,.]*)\s*(thousand|million|billion|bn|k|m|b)?\b([^.]{0,24})/gi;
  let best: { value: number; scored: boolean } | null = null;
  let match: RegExpExecArray | null;
  while ((match = re.exec(quote)) !== null) {
    const raw = match[1].replace(/,/g, '');
    const num = Number.parseFloat(raw);
    if (!Number.isFinite(num)) continue;
    const scaleWord = match[2]?.toLowerCase();
    const scale = scaleWord ? SCALE_WORDS[scaleWord] : 1;
    // A bare integer without a scale word and without a copies/units cue is
    // almost never a sales figure (dates, prices, versions) — skip it.
    const tail = (match[3] ?? '').toLowerCase();
    const near = /(copies|units|sold|sales)/.test(tail);
    if (!scaleWord && !near) continue;
    const value = num * scale;
    if (value <= 0) continue;
    if (!best || (near && !best.scored) || (near === best.scored && value > best.value)) {
      best = { value, scored: near };
    }
  }
  return best ? best.value : null;
}

function formatUnits(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return `${Math.round(n)}`;
}

type Scope = 'global' | 'pc' | 'ps' | 'xbox' | 'switch' | 'console';

const SCOPE_PATTERNS: Array<{ scope: Exclude<Scope, 'global' | 'console'>; re: RegExp }> = [
  { scope: 'pc', re: /\b(steam|pc)\b/i },
  { scope: 'ps', re: /\b(playstation|ps[45]|psn)\b/i },
  { scope: 'xbox', re: /\bxbox\b/i },
  { scope: 'switch', re: /\b(switch)\b/i },
];

const SCOPING_CONTEXT =
  /\b(on|via|for|through)\s+(steam|pc|playstation|ps[45]|xbox|switch|nintendo)\b|\b(steam|pc|playstation|ps[45]|xbox|switch)\s+(sales|copies|units|version|players)\b|copies\s+on\b/i;

const GLOBAL_HINT =
  /\b(worldwide|global(?:ly)?|all\s+platforms|combined|across)\b/i;

const SCOPE_TO_PLATFORM: Record<Exclude<Scope, 'global' | 'console'>, Platform> = {
  pc: Platform.PC,
  ps: Platform.PLAYSTATION,
  xbox: Platform.XBOX,
  switch: Platform.SWITCH,
};

// Compact port of the note→scope classifier used by the platform-split miner:
// only returns a single-platform verdict when the quote clearly scopes to it.
export function classifyPlatformScope(note: string): {
  platform: Platform | null;
  confidence: 'high' | 'low';
} {
  if (!note) return { platform: null, confidence: 'low' };

  const mentioned = [
    ...new Set(SCOPE_PATTERNS.filter((p) => p.re.test(note)).map((p) => p.scope)),
  ];

  if (mentioned.length >= 2) return { platform: Platform.GLOBAL, confidence: 'high' };
  if (mentioned.length === 1) {
    const hasScoping = SCOPING_CONTEXT.test(note);
    if (GLOBAL_HINT.test(note) && !hasScoping) {
      return { platform: Platform.GLOBAL, confidence: 'low' };
    }
    return {
      platform: SCOPE_TO_PLATFORM[mentioned[0]],
      confidence: hasScoping ? 'high' : 'low',
    };
  }
  if (GLOBAL_HINT.test(note)) return { platform: Platform.GLOBAL, confidence: 'high' };
  return { platform: null, confidence: 'low' };
}

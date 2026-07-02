import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';

/**
 * Read-only analysis: mines the free-text `milestone.note` field to build a
 * ground-truth table of per-platform sales figures, so we can LEARN the
 * PC-vs-console share instead of relying on the arbitrary Boxleiter proxy
 * weights currently used in reference-profile ETL.
 *
 * Milestones are almost never a clean per-platform breakdown. They are usually
 * either a GLOBAL "X million worldwide" total or a single-platform figure
 * ("9 million on PC", "65,340 copies on Steam"). We therefore:
 *   1. classify each milestone by platform SCOPE (global / pc / ps / xbox /
 *      switch / console) from its note text;
 *   2. per game, keep the MAX units per scope (cumulative sales grow, so the
 *      max is the latest known figure for that scope);
 *   3. DERIVE a share label wherever two compatible scopes coexist, e.g.
 *        - global + pc            -> pcShare = pc / global
 *        - global + console       -> pcShare = 1 - console / global
 *        - pc + (ps|xbox|switch)  -> shares from the scoped figures directly
 *      and also fold in the Steam leak (PC ground truth) as a `pc` figure.
 *
 * Output: a summary to stdout + a JSON report of every derived label (with the
 * source note snippets) to scripts/.milestone-platform-splits.json for audit.
 *
 * Usage (from backend/):
 *   npx ts-node src/scripts/mine-milestone-platform-splits.ts
 */

type Scope = 'global' | 'pc' | 'ps' | 'xbox' | 'switch' | 'console';

interface MilestoneRow {
  gameId: string;
  name: string;
  source: string;
  units: number;
  note: string | null;
  leakUnits: number | null;
}

const PLATFORM_PATTERNS: Array<{
  scope: Exclude<Scope, 'global' | 'console'>;
  re: RegExp;
}> = [
  { scope: 'pc', re: /\b(steam|pc)\b/i },
  { scope: 'ps', re: /\b(playstation|ps[45]|psn)\b/i },
  { scope: 'xbox', re: /\bxbox\b/i },
  { scope: 'switch', re: /\b(nintendo(?!\s+switch)?|switch)\b/i },
];

// Phrases that scope a figure to a single platform ("... on Steam",
// "9 million on PC", "copies on PlayStation", "PC sales", "via Steam").
const SCOPING_CONTEXT =
  /\b(on|via|for|through)\s+(steam|pc|playstation|ps[45]|xbox|switch|nintendo)\b|\b(steam|pc|playstation|ps[45]|xbox|switch)\s+(sales|copies|units|version|players)\b|copies\s+on\b/i;

const GLOBAL_HINT =
  /\b(worldwide|global(?:ly)?|all\s+platforms|combined|across)\b/i;
const CONSOLE_HINT = /\bconsole(s)?\b/i;

function classifyScope(note: string | null): {
  scope: Scope;
  confidence: 'high' | 'low';
} {
  if (!note) return { scope: 'global', confidence: 'low' };

  const mentioned = PLATFORM_PATTERNS.filter((p) => p.re.test(note)).map(
    (p) => p.scope,
  );
  const unique = [...new Set(mentioned)];

  // Multiple platforms named in one figure => it's a multi-platform (global) total.
  if (unique.length >= 2) return { scope: 'global', confidence: 'high' };

  if (unique.length === 1) {
    const hasScoping = SCOPING_CONTEXT.test(note);
    // A "worldwide/global" qualifier overrides an incidental single mention.
    if (GLOBAL_HINT.test(note) && !hasScoping) {
      return { scope: 'global', confidence: 'low' };
    }
    return { scope: unique[0], confidence: hasScoping ? 'high' : 'low' };
  }

  // No specific platform named.
  if (CONSOLE_HINT.test(note)) return { scope: 'console', confidence: 'high' };
  return { scope: 'global', confidence: 'high' };
}

interface GameAgg {
  gameId: string;
  name: string;
  perScope: Partial<Record<Scope, { units: number; note: string }>>;
}

interface DerivedLabel {
  gameId: string;
  name: string;
  method: string;
  pcShare: number | null;
  psShare: number | null;
  xboxShare: number | null;
  switchShare: number | null;
  consoleShare: number | null;
  basis: Record<string, number>;
}

function deriveLabel(agg: GameAgg): DerivedLabel | null {
  const g = agg.perScope.global?.units ?? null;
  const pc = agg.perScope.pc?.units ?? null;
  const ps = agg.perScope.ps?.units ?? null;
  const xbox = agg.perScope.xbox?.units ?? null;
  const sw = agg.perScope.switch?.units ?? null;
  const con = agg.perScope.console?.units ?? null;

  const base = (extra: Record<string, number | null>): Record<string, number> =>
    Object.fromEntries(
      Object.entries(extra).filter(([, v]) => v !== null && v !== undefined),
    ) as Record<string, number>;

  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

  // A) global + pc  -> most reliable single split (PC vs rest).
  if (g !== null && pc !== null && g > 0 && pc <= g * 1.15) {
    const pcShare = clamp01(pc / g);
    return {
      gameId: agg.gameId,
      name: agg.name,
      method: 'global_vs_pc',
      pcShare,
      psShare: null,
      xboxShare: null,
      switchShare: null,
      consoleShare: 1 - pcShare,
      basis: base({ global: g, pc }),
    };
  }

  // B) global + console  -> PC vs console.
  if (g !== null && con !== null && g > 0 && con <= g * 1.15) {
    const consoleShare = clamp01(con / g);
    return {
      gameId: agg.gameId,
      name: agg.name,
      method: 'global_vs_console',
      pcShare: 1 - consoleShare,
      psShare: null,
      xboxShare: null,
      switchShare: null,
      consoleShare,
      basis: base({ global: g, console: con }),
    };
  }

  // C) explicit per-platform figures (need pc + at least one console platform).
  const scoped = { pc, ps, xbox, switch: sw };
  const present = Object.entries(scoped).filter(([, v]) => v !== null && v > 0);
  if (pc !== null && present.length >= 2) {
    const total = present.reduce((s, [, v]) => s + (v as number), 0);
    return {
      gameId: agg.gameId,
      name: agg.name,
      method: 'platform_scoped_sum',
      pcShare: pc / total,
      psShare: ps !== null ? ps / total : null,
      xboxShare: xbox !== null ? xbox / total : null,
      switchShare: sw !== null ? sw / total : null,
      consoleShare: 1 - pc / total,
      basis: base({ pc, ps, xbox, switch: sw }),
    };
  }

  // D) global + single console platform (partial: only that platform's share).
  if (g !== null && g > 0) {
    if (ps !== null && ps <= g * 1.15) {
      return {
        gameId: agg.gameId,
        name: agg.name,
        method: 'global_vs_ps_partial',
        pcShare: null,
        psShare: clamp01(ps / g),
        xboxShare: null,
        switchShare: null,
        consoleShare: null,
        basis: base({ global: g, ps }),
      };
    }
  }

  return null;
}

async function main(): Promise<void> {
  const logger = new Logger('MineMilestonePlatformSplits');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const dataSource = app.get(DataSource);

  const rows = await dataSource.query<MilestoneRow[]>(
    `SELECT m."gameId" AS "gameId",
            g.name AS name,
            m.source AS source,
            m.units AS units,
            m.note AS note,
            (SELECT max(s.value)::int
               FROM signal_snapshot s
              WHERE s."gameId" = m."gameId"
                AND s.metric = 'STEAM_PLAYERS_LEAK') AS "leakUnits"
       FROM milestone m
       JOIN game g ON g.id = m."gameId"
      WHERE m."rejectedAt" IS NULL
        AND g."deletedAt" IS NULL
        AND m."isEngagement" = false`,
  );

  const scopeCounts: Record<string, number> = {};
  const games = new Map<string, GameAgg>();

  for (const r of rows) {
    const { scope, confidence } = classifyScope(r.note);
    scopeCounts[`${scope}:${confidence}`] =
      (scopeCounts[`${scope}:${confidence}`] ?? 0) + 1;

    let agg = games.get(r.gameId);
    if (!agg) {
      agg = { gameId: r.gameId, name: r.name, perScope: {} };
      games.set(r.gameId, agg);
    }
    // Keep the largest figure per scope (latest cumulative). Low-confidence
    // single-platform mentions are still recorded but never override a
    // high-confidence one for the same scope.
    const existing = agg.perScope[scope];
    if (!existing || r.units > existing.units) {
      agg.perScope[scope] = {
        units: r.units,
        note: (r.note ?? '').slice(0, 200),
      };
    }
  }

  // Fold the Steam leak in as a hard PC ground-truth figure when present and
  // larger than any note-derived PC figure.
  let leakInjected = 0;
  for (const agg of games.values()) {
    const leak = rows.find((r) => r.gameId === agg.gameId)?.leakUnits ?? null;
    if (leak !== null && leak > 0) {
      const existing = agg.perScope.pc;
      if (!existing || leak > existing.units) {
        agg.perScope.pc = { units: leak, note: '[steam leak PC truth]' };
        leakInjected++;
      }
    }
  }

  const labels: DerivedLabel[] = [];
  for (const agg of games.values()) {
    const label = deriveLabel(agg);
    if (label) labels.push(label);
  }

  const byMethod: Record<string, number> = {};
  for (const l of labels) byMethod[l.method] = (byMethod[l.method] ?? 0) + 1;

  const reportPath = resolve(
    __dirname,
    '../../../scripts/.milestone-platform-splits.json',
  );
  writeFileSync(reportPath, JSON.stringify(labels, null, 2));
  await app.close();

  logger.log(`Milestones scanned: ${rows.length} across ${games.size} games.`);
  logger.log(`Scope distribution (scope:confidence -> count):`);
  for (const [k, v] of Object.entries(scopeCounts).sort(
    (a, b) => b[1] - a[1],
  )) {
    logger.log(`  ${k}: ${v}`);
  }
  logger.log(`Leak PC-truth injected for ${leakInjected} game(s).`);
  logger.log(`Derived ${labels.length} platform-split label(s):`);
  for (const [k, v] of Object.entries(byMethod).sort((a, b) => b[1] - a[1])) {
    logger.log(`  ${k}: ${v}`);
  }
  const withPcShare = labels.filter((l) => l.pcShare !== null).length;
  logger.log(`Labels with a usable pcShare: ${withPcShare}.`);
  logger.log(`Report written to ${reportPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AuditVerdict } from '../entities/milestone-audit.entity';
import {
  AuditFinding,
  MilestoneAuditService,
} from '../milestone-audit/milestone-audit.service';

/**
 * Phase 1 — milestone audit (report only).
 *
 * Re-judges every active milestone against its OWN stored evidence (verbatim
 * `note`, sourceUrl, units, platform, date) using an LLM critic, and writes a
 * report of what WOULD be fixed or rejected. It never mutates a milestone or a
 * game — the only writes are the `milestone_audit` findings rows (needed for
 * incremental re-runs and the future review queue).
 *
 * Usage (from backend/):
 *   npm run audit:milestones                 # incremental, persists findings
 *   npm run audit:milestones -- --full       # re-audit everything (ignore prior findings)
 *   npm run audit:milestones -- --game <id>  # single game
 *   npm run audit:milestones -- --limit 50   # cap the number of milestones audited
 *   npm run audit:milestones -- --dry-run    # compute + report, persist NOTHING
 */

interface Args {
  gameId?: string;
  limit?: number;
  full: boolean;
  persist: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { full: false, persist: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--full') args.full = true;
    else if (a === '--dry-run') args.persist = false;
    else if (a === '--game') args.gameId = argv[++i];
    else if (a === '--limit') args.limit = Number.parseInt(argv[++i], 10);
  }
  return args;
}

function summarize(findings: AuditFinding[]): {
  byVerdict: Record<string, number>;
  llmUsed: number;
} {
  const byVerdict: Record<string, number> = {};
  let llmUsed = 0;
  for (const f of findings) {
    byVerdict[f.verdict] = (byVerdict[f.verdict] ?? 0) + 1;
    if (f.llmUsed) llmUsed++;
  }
  return { byVerdict, llmUsed };
}

async function main(): Promise<void> {
  const logger = new Logger('AuditMilestones');
  const args = parseArgs(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const service = app.get(MilestoneAuditService);

  logger.log(
    `Auditing milestones (incremental=${!args.full}, persist=${args.persist}` +
      `${args.gameId ? `, game=${args.gameId}` : ''}${args.limit ? `, limit=${args.limit}` : ''}).`,
  );

  const { findings, scanned, skipped, totalActive } = await service.audit({
    gameId: args.gameId,
    limit: args.limit,
    incremental: !args.full,
    persist: args.persist,
    onProgress: (done, total) => {
      if (done % 25 === 0 || done === total) {
        logger.log(`  audited ${done}/${total}…`);
      }
    },
  });

  const { byVerdict, llmUsed } = summarize(findings);

  const actionable = findings
    .filter((f) => f.verdict !== AuditVerdict.OK)
    .sort((a, b) => b.confidence - a.confidence);

  const reportPath = resolve(
    __dirname,
    '../../../scripts/.milestone-audit-report.json',
  );
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalActive,
        scanned,
        skipped,
        summary: { byVerdict, llmUsed },
        findings: actionable,
      },
      null,
      2,
    ),
  );

  await app.close();

  logger.log('──────────────────────────────────────────────');
  logger.log(`Active milestones: ${totalActive}`);
  logger.log(`Scanned this run:  ${scanned} (skipped unchanged: ${skipped})`);
  logger.log(`LLM critic used:   ${llmUsed}/${scanned}`);
  logger.log('Verdicts:');
  for (const [k, v] of Object.entries(byVerdict).sort((a, b) => b[1] - a[1])) {
    logger.log(`  ${k}: ${v}`);
  }
  logger.log(`Actionable findings (FIX/REJECT): ${actionable.length}`);
  logger.log(`Full report: ${reportPath}`);
  if (!args.persist) {
    logger.log('(dry-run: no milestone_audit rows were written)');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

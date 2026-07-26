import Link from 'next/link';
import {
  adminFetch,
  type ConsistencyIssuesResult,
  type ConsistencyRule,
} from '@/lib/admin';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConsistencyGameCard } from '../../_components/ConsistencyGameCard';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

const RULE_LABEL: Record<ConsistencyRule, string> = {
  PRE_RELEASE: 'Pre-release date',
  NON_MONOTONIC: 'Non-monotonic',
  PLATFORM_SUM_EXCEEDS_GLOBAL: 'Platforms sum > global',
  PLATFORM_EXCEEDS_GLOBAL: 'Platform > global',
  MAGNITUDE_OUTLIER: 'Magnitude outlier',
};

const RULE_HELP: Record<ConsistencyRule, string> = {
  PRE_RELEASE: 'Figure dated before the game released.',
  NON_MONOTONIC:
    'A point that breaks the game/platform growth curve (dip or spike).',
  PLATFORM_SUM_EXCEEDS_GLOBAL:
    'Per-platform figures add up to more than the worldwide total.',
  PLATFORM_EXCEEDS_GLOBAL:
    'A single-platform figure exceeds the worldwide total.',
  MAGNITUDE_OUTLIER: 'A point that dwarfs its neighbours (stray digit).',
};

export default async function MilestoneConsistencyPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const result = await adminFetch<ConsistencyIssuesResult>(
    '/milestones/consistency',
  );

  const pageCount = Math.max(1, Math.ceil(result.games.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount);
  const start = (clampedPage - 1) * PAGE_SIZE;
  const pageGames = result.games.slice(start, start + PAGE_SIZE);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">
          Milestone consistency
        </h1>
        <p className="text-muted-foreground text-sm">
          Deterministic checks against each game&apos;s own sales trajectory. No
          LLM, recomputed live.{' '}
          <span className="text-foreground font-medium">
            {result.milestonesFlagged.toLocaleString()}
          </span>{' '}
          milestones flagged across{' '}
          <span className="text-foreground font-medium">
            {result.gamesFlagged.toLocaleString()}
          </span>{' '}
          games.
        </p>
      </header>

      <Card>
        <CardContent className="flex flex-wrap gap-x-6 gap-y-3 pt-6">
          {(Object.keys(RULE_LABEL) as ConsistencyRule[]).map((rule) => (
            <div key={rule} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{RULE_LABEL[rule]}</Badge>
                <span className="text-sm font-medium tabular-nums">
                  {(result.byRule[rule] ?? 0).toLocaleString()}
                </span>
              </div>
              <span className="text-muted-foreground max-w-[220px] text-xs">
                {RULE_HELP[rule]}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      {pageGames.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-12 text-center">
            No consistency issues found. 🎉
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {pageGames.map((group) => (
            <ConsistencyGameCard key={group.gameId} group={group} />
          ))}
        </div>
      )}

      {pageCount > 1 && (
        <nav className="flex items-center justify-center gap-2">
          {clampedPage > 1 && (
            <Button asChild variant="outline" size="sm">
              <Link href={`?page=${clampedPage - 1}`}>← Previous</Link>
            </Button>
          )}
          <span className="text-muted-foreground text-sm">
            Page {clampedPage} of {pageCount}
          </span>
          {clampedPage < pageCount && (
            <Button asChild variant="outline" size="sm">
              <Link href={`?page=${clampedPage + 1}`}>Next →</Link>
            </Button>
          )}
        </nav>
      )}
    </div>
  );
}

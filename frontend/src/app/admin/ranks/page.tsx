import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { adminFetch, type AdminRankRow } from '@/lib/admin';
import { recomputeRanks } from '../actions';

export const dynamic = 'force-dynamic';

function formatPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default async function AdminRanksPage() {
  const ranks = await adminFetch<AdminRankRow[]>('/ranks');
  const computedAt = ranks[0]?.computedAt;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8">
      <header className="flex items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold tracking-tight">Home-grown rank</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            A weekly leaderboard of our own tracked universe, built from review
            velocity (Δ cumulative Steam reviews per week) — an observed
            units-proxy, never the model&apos;s estimated units. Each week the
            games that moved are ranked; these aggregates summarise a game&apos;s
            position series. Rank is relative to our universe (not Steam&apos;s
            whole catalogue); percentiles normalise for the universe growing over
            time. Lower rank / percentile = better.
          </p>
          {computedAt && (
            <p className="text-muted-foreground mt-2 text-xs">
              Last computed {formatDate(computedAt)} · {ranks.length} charted
              game(s)
            </p>
          )}
        </div>
        <form action={recomputeRanks}>
          <Button type="submit" variant="outline" className="shrink-0">
            <RefreshCw aria-hidden="true" className="size-4" />
            Recompute
          </Button>
        </form>
      </header>

      {ranks.length === 0 ? (
        <Card>
          <p className="text-muted-foreground p-6 text-sm">
            No rank computed yet. Hit <strong>Recompute</strong> above, or run{' '}
            <code className="font-mono text-xs">
              npx ts-node src/scripts/recompute-homegrown-rank.ts
            </code>{' '}
            from the backend (needs the STEAM_REVIEWS history to be populated).
          </p>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Game</TableHead>
                <TableHead>Year</TableHead>
                <TableHead
                  className="text-right"
                  title="Weeks with review activity that were ranked"
                >
                  Weeks
                </TableHead>
                <TableHead
                  className="text-right"
                  title="Best weekly position ever reached (lower is better)"
                >
                  Peak
                </TableHead>
                <TableHead
                  className="text-right"
                  title="Mean weekly position over charted weeks"
                >
                  Avg
                </TableHead>
                <TableHead
                  className="text-right"
                  title="Best position as a fraction of that week's field (lower is better)"
                >
                  Peak %ile
                </TableHead>
                <TableHead
                  className="text-right"
                  title="Weeks spent in the top 10% of the field (sustain)"
                >
                  Wks top10%
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranks.map((r, i) => (
                <TableRow key={r.gameId} className="hover:bg-muted/40">
                  <TableCell className="text-muted-foreground text-xs tabular-nums">
                    {i + 1}
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      href={`/admin/games/${r.gameId}`}
                      className="hover:underline"
                    >
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {r.year ?? '—'}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {r.weeksCharted}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    #{r.peakRank}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {r.avgRank.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {formatPct(r.peakPercentile)}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {r.weeksTopDecile}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

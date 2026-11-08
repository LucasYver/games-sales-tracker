import Link from 'next/link';
import {
  adminFetch,
  requireAdminSession,
  type AdminDashboardOverview,
  type AdminDashboardQuality,
} from '@/lib/admin';
import type { Platform } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { compactNumber } from './_components/format';
import { MilestonesAddedChart } from './_components/MilestonesAddedChart';
import { RatioHistogramChart } from './_components/RatioHistogramChart';
import {
  SOURCE_GROUPS,
  groupBySource,
} from './_components/milestone-source-groups';

export const dynamic = 'force-dynamic';

const PLATFORM_LABELS: Partial<Record<Platform, string>> = {
  GLOBAL: 'Worldwide',
  PC: 'PC',
  PLAYSTATION: 'PlayStation',
  XBOX: 'Xbox',
  SWITCH: 'Switch',
};

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function formatFactor(value: number | null): string {
  return value === null ? '—' : `×${value.toFixed(2)}`;
}

function StatCard({
  label,
  value,
  lines,
}: {
  label: string;
  value: string;
  lines: Array<{ text: string; positive?: boolean }>;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-3xl font-bold tabular-nums">{value}</p>
        {lines.map((line) => (
          <p
            key={line.text}
            className={`mt-1 text-xs ${
              line.positive
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-muted-foreground'
            }`}
          >
            {line.text}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}

function SectionCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {description && (
          <p className="text-muted-foreground text-xs">{description}</p>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ShareBar({
  label,
  part,
  total,
}: {
  label: string;
  part: number;
  total: number;
}) {
  const pct = percent(part, total);
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-24 shrink-0">{label}</span>
      <div
        className="bg-muted h-2 flex-1 overflow-hidden rounded-full"
        role="img"
        aria-label={`${label}: ${pct}%`}
      >
        <div
          className="bg-primary h-full rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 text-right tabular-nums">{pct}%</span>
      <span className="text-muted-foreground hidden w-28 text-right text-xs tabular-nums sm:inline">
        {part.toLocaleString()} / {total.toLocaleString()}
      </span>
    </div>
  );
}

function SourceMix({
  bySource,
}: {
  bySource: AdminDashboardOverview['milestones']['bySource'];
}) {
  const groups = groupBySource(bySource);
  const total = Object.values(groups).reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-4">
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
        {SOURCE_GROUPS.map((g) =>
          groups[g.key] > 0 ? (
            <div
              key={g.key}
              style={{
                width: `${(groups[g.key] / total) * 100}%`,
                background: g.color,
              }}
              title={`${g.label}: ${groups[g.key].toLocaleString()}`}
            />
          ) : null,
        )}
      </div>
      <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        {SOURCE_GROUPS.map((g) => (
          <li key={g.key} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: g.color }}
              aria-hidden
            />
            <span>{g.label}</span>
            <span className="text-muted-foreground ml-auto tabular-nums">
              {groups[g.key].toLocaleString()} · {percent(groups[g.key], total)}
              %
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GenreGaps({ genres }: { genres: AdminDashboardQuality['byGenre'] }) {
  if (genres.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No genre has enough comparisons yet.
      </p>
    );
  }
  const maxFactor = Math.max(...genres.map((g) => g.medianFactor));
  return (
    <div className="space-y-3">
      {genres.map((g) => (
        <div key={g.genre} className="flex items-center gap-3 text-sm">
          <span className="w-36 shrink-0 truncate" title={g.genre}>
            {g.genre}
          </span>
          <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full"
              style={{ width: `${(g.medianFactor / maxFactor) * 100}%` }}
            />
          </div>
          <span className="w-12 text-right tabular-nums">
            {formatFactor(g.medianFactor)}
          </span>
          <span className="text-muted-foreground hidden w-28 text-right text-xs sm:inline">
            {g.medianRatio >= 1 ? 'over' : 'under'} · {g.comparisons} games
          </span>
        </div>
      ))}
    </div>
  );
}

const AGREEMENT_LABELS: Record<
  AdminDashboardQuality['divergences'][number]['agreement'],
  string
> = {
  strong: 'Strong',
  weak: 'Weak',
  conflict: 'Conflict',
};

function Divergences({ rows }: { rows: AdminDashboardQuality['divergences'] }) {
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No game has both an estimate and a declared figure yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Game</TableHead>
            <TableHead>Platform</TableHead>
            <TableHead className="text-right">Declared</TableHead>
            <TableHead className="text-right">Estimated</TableHead>
            <TableHead className="text-right">Estimate ÷ declared</TableHead>
            <TableHead>Agreement</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={`${r.gameId}-${r.platform}`}>
              <TableCell>
                <Link
                  href={`/admin/games/${r.gameId}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {r.name}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {PLATFORM_LABELS[r.platform] ?? r.platform}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {compactNumber(r.declaredUnits)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {compactNumber(r.estimatedUnits)}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatFactor(r.ratio)}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    r.agreement === 'conflict' ? 'destructive' : 'secondary'
                  }
                >
                  {AGREEMENT_LABELS[r.agreement]}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function AdminDashboard() {
  await requireAdminSession();
  // Both endpoints answer in well under 200 ms, so the page waits for both
  // rather than streaming the accuracy section in later.
  const [overview, quality] = await Promise.all([
    adminFetch<AdminDashboardOverview>('/dashboard'),
    adminFetch<AdminDashboardQuality>('/dashboard/quality'),
  ]);
  const { games, milestones } = overview;
  const platforms = overview.platformCoverage.filter((p) => p.games > 0);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm">
          How much data the tracker holds and how close its estimates land. Cron
          progress and manual runs are on the{' '}
          <Link href="/admin/crons" className="underline underline-offset-2">
            Crons
          </Link>{' '}
          page.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Games"
          value={compactNumber(games.total)}
          lines={[
            {
              text: `+${games.addedLast7d} this week`,
              positive: games.addedLast7d > 0,
            },
            { text: `${games.core.toLocaleString()} CORE` },
          ]}
        />
        <StatCard
          label="Milestones"
          value={compactNumber(milestones.total)}
          lines={[
            {
              text: `+${milestones.addedLast7d} this week`,
              positive: milestones.addedLast7d > 0,
            },
            {
              text: `${milestones.undated} undated · ${milestones.rejected.toLocaleString()} rejected`,
            },
          ]}
        />
        <StatCard
          label="Games with sales"
          value={compactNumber(games.withSales)}
          lines={[
            {
              text: `+${games.withSalesAddedLast7d} this week`,
              positive: games.withSalesAddedLast7d > 0,
            },
            {
              text: `${compactNumber(games.estimated)} games estimated (2017+)`,
            },
          ]}
        />
        <StatCard
          label="Median gap"
          value={formatFactor(quality.medianFactor)}
          lines={[
            {
              text: `${percent(quality.withinFactor1_5, quality.comparisons)}% within ×1.5`,
            },
            { text: `${quality.comparisons.toLocaleString()} games compared` },
          ]}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Data</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard
            title="Milestones added"
            description="By date added: last 30 days or last 12 weeks. Bulk imports show up as spikes."
          >
            <MilestonesAddedChart
              days={overview.dailyMilestones}
              weeks={overview.weeklyMilestones}
            />
          </SectionCard>
          <SectionCard
            title="CORE games with a sales figure"
            description="Released paid CORE games, by release year."
          >
            <div className="space-y-3">
              {overview.coreCoverageByYear.map((y) => (
                <ShareBar
                  key={y.label}
                  label={y.label}
                  part={y.withMilestone}
                  total={y.games}
                />
              ))}
            </div>
          </SectionCard>
          <SectionCard
            title="Games with a sales figure, by platform"
            description="Worldwide counts every paid game; a platform counts the paid games released on it."
          >
            <div className="space-y-3">
              {platforms.map((p) => (
                <ShareBar
                  key={p.platform}
                  label={PLATFORM_LABELS[p.platform] ?? p.platform}
                  part={p.withMilestone}
                  total={p.games}
                />
              ))}
            </div>
          </SectionCard>
          <SectionCard
            title="Milestones by source"
            description={`${milestones.total.toLocaleString()} milestones kept.`}
          >
            <SourceMix bySource={milestones.bySource} />
          </SectionCard>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Estimate accuracy
          </h2>
          <p className="text-muted-foreground text-sm">
            Each game&apos;s latest estimate against the declared figure it was
            checked with. Games released before 2017 are left out.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard
            title="Estimate ÷ declared"
            description={`Strong ${quality.agreement.strong} · weak ${quality.agreement.weak} · conflict ${quality.agreement.conflict}`}
          >
            <RatioHistogramChart histogram={quality.histogram} />
          </SectionCard>
          <SectionCard
            title="Median gap by genre"
            description="Most compared genres. A game counts in each of its genres."
          >
            <GenreGaps genres={quality.byGenre} />
          </SectionCard>
        </div>
        <SectionCard
          title="Largest gaps"
          description={`${quality.agreement.conflict} games in conflict with their declared figure.`}
        >
          <Divergences rows={quality.divergences} />
        </SectionCard>
      </section>
    </div>
  );
}

import Link from 'next/link';
import {
  adminFetch,
  requireAdminSession,
  type AdminDashboardOverview,
} from '@/lib/admin';
import type { Platform } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { compactNumber } from './_components/format';
import { MilestonesAddedChart } from './_components/MilestonesAddedChart';
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

export default async function AdminDashboard() {
  await requireAdminSession();
  const overview = await adminFetch<AdminDashboardOverview>('/dashboard');
  const { games, milestones } = overview;
  const platforms = overview.platformCoverage.filter((p) => p.games > 0);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm">
          How much data the tracker holds and how fast it grows. Cron progress
          and manual runs are on the{' '}
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
            { text: `${percent(games.withSales, games.total)}% of all games` },
          ]}
        />
        <StatCard
          label="Games estimated"
          value={compactNumber(games.estimated)}
          lines={[{ text: 'Released from 2017 on, or not dated yet' }]}
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
    </div>
  );
}

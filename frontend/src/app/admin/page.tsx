import { adminFetch, type AdminStats } from '@/lib/admin';
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
import { SteamPsBackfillButton } from './_components/SteamPsBackfillButton';

export const dynamic = 'force-dynamic';

function compactNumber(n: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}

function StatCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
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
        {sublabel && (
          <p className="text-muted-foreground mt-1 text-xs">{sublabel}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default async function AdminDashboard() {
  const stats = await adminFetch<AdminStats>('/stats');

  const lastCapturedAt = stats.signals.lastCapturedAt
    ? new Date(stats.signals.lastCapturedAt).toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—';

  const bySource = Object.entries(stats.milestones.bySource).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            Health overview of the tracker.
          </p>
        </div>
        <SteamPsBackfillButton />
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Games"
          value={compactNumber(stats.games.total)}
          sublabel={`${stats.games.withSales} with declared sales · ${stats.games.withCalibration} calibrated`}
        />
        <StatCard
          label="Milestones"
          value={compactNumber(stats.milestones.total)}
          sublabel={`${stats.milestones.undated} undated`}
        />
        <StatCard
          label="Estimates"
          value={compactNumber(stats.estimates.total)}
          sublabel={`${stats.games.withEstimate} games with at least one`}
        />
        <StatCard
          label="Trusted sources"
          value={compactNumber(stats.trustedSources.total)}
          sublabel={`${stats.trustedSources.active} active · ${stats.trustedSources.withFeed} with RSS`}
        />
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold tracking-wide uppercase">
              Milestones by source
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bySource.map(([source, count]) => (
                  <TableRow key={source}>
                    <TableCell>
                      <Badge variant="outline">{source}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold tracking-wide uppercase">
              Signal pipeline
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            <p>
              {compactNumber(stats.signals.steamReviewsTotal)} Steam review
              snapshots stored. Last captured:{' '}
              <span className="text-foreground font-medium">
                {lastCapturedAt}
              </span>
              .
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

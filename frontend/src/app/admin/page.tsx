import Link from 'next/link';
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
import { compactNumber, formatTimestamp } from './_components/format';

export const dynamic = 'force-dynamic';

function StatCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string | number;
  sublabel?: string | string[];
}) {
  const sublabels = sublabel
    ? Array.isArray(sublabel)
      ? sublabel
      : [sublabel]
    : [];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-3xl font-bold tabular-nums">{value}</p>
        {sublabels.map((line) => (
          <p key={line} className="text-muted-foreground mt-1 text-xs">
            {line}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}

export default async function AdminDashboard() {
  const stats = await adminFetch<AdminStats>('/stats');

  const bySource = Object.entries(stats.milestones.bySource).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            Health overview of the tracker. Cron progress and manual runs are
            on the{' '}
            <Link href="/admin/crons" className="underline underline-offset-2">
              Crons
            </Link>{' '}
            page.
          </p>
        </div>
      </header>

      {stats.steamReviewsHealth.problems.length > 0 && (
        <section
          role="alert"
          className="border-destructive bg-destructive/10 rounded-lg border p-4"
        >
          <h2 className="text-destructive font-semibold">
            Steam reviews are not being collected
          </h2>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {stats.steamReviewsHealth.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-2 text-xs">
            Last value stored:{' '}
            {formatTimestamp(stats.steamReviewsHealth.lastCapturedAt)}. Sales
            estimates are running on frozen values.{' '}
            <Link href="/admin/crons" className="underline underline-offset-2">
              Open the crons
            </Link>
            .
          </p>
        </section>
      )}

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Games"
          value={compactNumber(stats.games.total)}
          sublabel={`${stats.games.withSales} with declared sales`}
        />
        <StatCard
          label="Milestones"
          value={compactNumber(stats.milestones.total)}
          sublabel={[
            `${stats.milestones.undated} undated`,
            `${stats.milestones.rejected.toLocaleString()} rejected`,
          ]}
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
    </div>
  );
}

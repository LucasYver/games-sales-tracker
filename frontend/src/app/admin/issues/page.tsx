import Link from 'next/link';
import {
  AlertTriangle,
  CalendarX,
  Calculator,
  Quote,
  Wifi,
  Globe,
} from 'lucide-react';
import { adminFetch, type AdminIssues } from '@/lib/admin';
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
import { DeleteButton } from '../_components/DeleteButton';
import { deleteSalesRecord, deleteTrustedSource } from '../actions';

export const dynamic = 'force-dynamic';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default async function AdminIssuesPage() {
  const issues = await adminFetch<AdminIssues>('/issues');

  const totalProblems =
    issues.undatedSalesRecords.count +
    issues.suspectQuotes.count +
    issues.calibrationOutliers.count +
    issues.staleGames.count +
    issues.inactiveTrustedSources.count +
    issues.gamesWithoutAnySignal.count;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8">
      <header className="flex items-start gap-3">
        <AlertTriangle
          aria-hidden="true"
          className="text-amber-500 mt-1 size-6"
        />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Issues</h1>
          <p className="text-muted-foreground text-sm">
            {totalProblems.toLocaleString()} potential issues across the
            tracker. Investigate and prune.
          </p>
        </div>
      </header>

      {/* Undated sales records */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide uppercase">
            <CalendarX aria-hidden="true" className="size-4" />
            Undated sales records ({issues.undatedSalesRecords.count})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {issues.undatedSalesRecords.items.length === 0 ? (
            <p className="text-muted-foreground p-6 text-sm">
              All sales records have a reported date.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Game</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead>Quote</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {issues.undatedSalesRecords.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        href={`/admin/games/${r.gameId}`}
                        className="hover:text-primary hover:underline"
                      >
                        {r.gameName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.source}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{r.platform}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.units.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-md truncate text-xs">
                      {r.note ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <DeleteButton
                        action={deleteSalesRecord.bind(null, r.id)}
                        confirmMessage="Delete this undated record?"
                        iconOnly
                        label="Delete record"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Suspect quotes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide uppercase">
            <Quote aria-hidden="true" className="size-4" />
            Suspect quotes ({issues.suspectQuotes.count})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {issues.suspectQuotes.items.length === 0 ? (
            <p className="text-muted-foreground p-6 text-sm">
              No suspicious quotes detected in the recent window.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Game</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead>Reported</TableHead>
                  <TableHead>Quote</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {issues.suspectQuotes.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        href={`/admin/games/${r.gameId}`}
                        className="hover:text-primary hover:underline"
                      >
                        {r.gameName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.source}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.units.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(r.reportedAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-md truncate text-xs">
                      {r.note ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <DeleteButton
                        action={deleteSalesRecord.bind(null, r.id)}
                        confirmMessage="Delete this suspect record?"
                        iconOnly
                        label="Delete record"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Calibration outliers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide uppercase">
            <Calculator aria-hidden="true" className="size-4" />
            Calibration outliers ({issues.calibrationOutliers.count})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {issues.calibrationOutliers.items.length === 0 ? (
            <p className="text-muted-foreground p-6 text-sm">
              All calibrated multipliers are within plausible bounds.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Game</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead className="text-right">Multiplier</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {issues.calibrationOutliers.items.map((o) => (
                  <TableRow key={`${o.gameId}-${o.platform}`}>
                    <TableCell>
                      <Link
                        href={`/admin/games/${o.gameId}`}
                        className="hover:text-primary hover:underline"
                      >
                        {o.gameName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{o.platform}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {o.calibratedMultiplier.toFixed(2)}x
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Stale games */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide uppercase">
            <Wifi aria-hidden="true" className="size-4" />
            Stale games — no Steam signal in 30+ days ({issues.staleGames.count})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {issues.staleGames.items.length === 0 ? (
            <p className="text-muted-foreground p-6 text-sm">
              All games refreshed within the last 30 days.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Game</TableHead>
                  <TableHead>Last signal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {issues.staleGames.items.map((g) => (
                  <TableRow key={g.gameId}>
                    <TableCell>
                      <Link
                        href={`/admin/games/${g.gameId}`}
                        className="hover:text-primary hover:underline"
                      >
                        {g.gameName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(g.lastSignalAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Games without any signal at all */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide uppercase">
            <Wifi aria-hidden="true" className="size-4" />
            Games with zero signal ({issues.gamesWithoutAnySignal.count})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {issues.gamesWithoutAnySignal.items.length === 0 ? (
            <p className="text-muted-foreground p-6 text-sm">
              Every tracked game has at least one signal.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Game</TableHead>
                  <TableHead>Slug</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {issues.gamesWithoutAnySignal.items.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell>
                      <Link
                        href={`/admin/games/${g.id}`}
                        className="hover:text-primary hover:underline"
                      >
                        {g.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {g.slug}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Inactive trusted sources */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide uppercase">
            <Globe aria-hidden="true" className="size-4" />
            Trusted sources without any record (
            {issues.inactiveTrustedSources.count})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {issues.inactiveTrustedSources.items.length === 0 ? (
            <p className="text-muted-foreground p-6 text-sm">
              Every registered trusted source has produced at least one record.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {issues.inactiveTrustedSources.items.map((ts) => (
                  <TableRow key={ts.id}>
                    <TableCell>
                      <Link
                        href="/admin/trusted-sources"
                        className="hover:text-primary hover:underline"
                      >
                        {ts.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {ts.host ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{ts.salesSource}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DeleteButton
                        action={deleteTrustedSource.bind(null, ts.id)}
                        confirmMessage={`Remove inactive source "${ts.name}"?`}
                        iconOnly
                        label={`Delete ${ts.name}`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

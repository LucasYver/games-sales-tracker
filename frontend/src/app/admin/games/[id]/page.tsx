import Link from 'next/link';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { adminFetch, type AdminGameDetail } from '@/lib/admin';
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
import { Button } from '@/components/ui/button';
import { DeleteButton } from '../../_components/DeleteButton';
import { RefreshGameButton } from '../../_components/RefreshGameButton';
import { deleteGame, deleteSalesRecord } from '../../actions';

export const dynamic = 'force-dynamic';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default async function AdminGameDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const game = await adminFetch<AdminGameDetail>(`/games/${id}`);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href="/admin/games">
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to games
          </Link>
        </Button>
      </div>

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{game.name}</h1>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            {game.id}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {game.platforms.map((p) => (
              <Badge key={p} variant="secondary">
                {p}
              </Badge>
            ))}
            {game.isFree && <Badge variant="outline">Free-to-play</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RefreshGameButton gameId={game.id} />
          <DeleteButton
            action={deleteGame.bind(null, game.id)}
            confirmMessage={`Permanently delete "${game.name}"?`}
            label="Delete game"
          />
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold tracking-wide uppercase">
            Metadata
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
            <Field label="Slug" value={game.slug} mono />
            <Field
              label="IGDB ID"
              value={game.igdbId?.toString() ?? '—'}
              mono
            />
            <Field label="Release date" value={formatDate(game.releaseDate)} />
            <Field
              label="Calibrated PC"
              value={
                game.calibratedMultiplier
                  ? `${game.calibratedMultiplier.toFixed(2)}x`
                  : '—'
              }
            />
            <Field
              label="Calibrated PlayStation"
              value={
                game.calibratedPsMultiplier
                  ? `${game.calibratedPsMultiplier.toFixed(2)}x`
                  : '—'
              }
            />
            <Field
              label="Calibrated Xbox"
              value={
                game.calibratedXboxMultiplier
                  ? `${game.calibratedXboxMultiplier.toFixed(2)}x`
                  : '—'
              }
            />
            <Field
              label="Latest Steam reviews"
              value={
                game.latestReviews
                  ? `${game.latestReviews.toLocaleString()} (${formatDate(
                      game.latestReviewsAt,
                    )})`
                  : '—'
              }
            />
            <Field label="Created" value={formatDateTime(game.createdAt)} />
            <Field label="Updated" value={formatDateTime(game.updatedAt)} />
          </dl>
          {game.summary && (
            <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
              {game.summary}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold tracking-wide uppercase">
            Sales records ({game.salesRecords.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {game.salesRecords.length === 0 ? (
            <p className="text-muted-foreground p-6 text-sm">
              No sales records yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead>Reported</TableHead>
                  <TableHead>Publisher</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {game.salesRecords.map((sr) => (
                  <TableRow key={sr.id}>
                    <TableCell>
                      <Badge variant="outline">{sr.source}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{sr.platform}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {sr.units.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(sr.reportedAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {sr.publisher ?? '—'}
                    </TableCell>
                    <TableCell>
                      {sr.sourceUrl ? (
                        <a
                          href={sr.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
                        >
                          link
                          <ExternalLink
                            aria-hidden="true"
                            className="size-3"
                          />
                        </a>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-xs truncate text-xs">
                      {sr.note ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <DeleteButton
                        action={deleteSalesRecord.bind(null, sr.id)}
                        confirmMessage="Delete this sales record?"
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

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold tracking-wide uppercase">
            Estimates ({game.estimates.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {game.estimates.length === 0 ? (
            <p className="text-muted-foreground p-6 text-sm">
              No estimates yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Platform</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead className="text-right">Low</TableHead>
                  <TableHead className="text-right">High</TableHead>
                  <TableHead>Computed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {game.estimates.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Badge variant="secondary">{e.platform}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {e.method}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{e.confidence}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.estimatedLow.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.estimatedHigh.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDateTime(e.computedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold tracking-wide uppercase">
            Signal snapshots (last 200, {game.signals.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {game.signals.length === 0 ? (
            <p className="text-muted-foreground p-6 text-sm">
              No signals recorded.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Captured</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {game.signals.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">
                      {s.metric}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {s.source}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.value.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDateTime(s.capturedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold tracking-wide uppercase">
            Linked external sources ({game.sources.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {game.sources.length === 0 ? (
            <p className="text-muted-foreground p-6 text-sm">
              Not linked to any external source yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>External ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {game.sources.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Badge variant="outline">{s.source}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.externalId}
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

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-xs uppercase">{label}</dt>
      <dd
        className={
          mono ? 'font-mono text-xs break-all' : 'text-sm'
        }
      >
        {value}
      </dd>
    </div>
  );
}

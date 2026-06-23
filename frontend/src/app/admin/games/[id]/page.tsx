import Link from 'next/link';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { adminFetch, type AdminGameDetail } from '@/lib/admin';
import { cn } from '@/lib/utils';
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { DeleteButton } from '../../_components/DeleteButton';
import { RefreshGameButton } from '../../_components/RefreshGameButton';
import { ImportCcuHistoryButton } from '../../_components/ImportCcuHistoryButton';
import { EditGameForm } from '../../_components/EditGameForm';
import { EstimateHistoryChart } from '../../_components/EstimateHistoryChart';
import { CcuHistoryChart } from '../../_components/CcuHistoryChart';
import { LauncherProfileBadge } from '../../_components/LauncherProfileBadge';
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

function formatCalibration(
  multiplier: number | null,
  source: string | null,
): string {
  if (multiplier === null || multiplier === undefined) return '—';
  return source
    ? `${multiplier.toFixed(2)}x (${source})`
    : `${multiplier.toFixed(2)}x`;
}

function formatUnitsCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toString();
}

function formatRange(low: number, high: number): string {
  return low === high
    ? formatUnitsCompact(low)
    : `${formatUnitsCompact(low)} – ${formatUnitsCompact(high)}`;
}

// Strip leading `www.` and any path/query so a long URL collapses to a
// recognizable outlet identifier ("cdprojekt.com", "gamesindustry.biz", …).
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export default async function AdminGameDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const game = await adminFetch<AdminGameDetail>(`/games/${id}`);

  const latestSnapshot =
    game.estimateSnapshots.length > 0
      ? game.estimateSnapshots[game.estimateSnapshots.length - 1]
      : null;

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
          <ImportCcuHistoryButton gameId={game.id} />
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
        <CardContent className="flex flex-col gap-4">
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
              value={formatCalibration(
                game.calibratedMultiplier,
                game.calibrationSourcePc,
              )}
            />
            <Field
              label="Calibrated PlayStation"
              value={formatCalibration(
                game.calibratedPsMultiplier,
                game.calibrationSourcePs,
              )}
            />
            <Field
              label="Calibrated Xbox"
              value={formatCalibration(
                game.calibratedXboxMultiplier,
                game.calibrationSourceXbox,
              )}
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
            <Field
              label="All-time peak CCU"
              value={
                game.allTimePeakCcu
                  ? `${game.allTimePeakCcu.toLocaleString()} (${formatDate(
                      game.allTimePeakCcuAt,
                    )})`
                  : '—'
              }
            />
            <Field label="Created" value={formatDateTime(game.createdAt)} />
            <Field label="Updated" value={formatDateTime(game.updatedAt)} />
            <Field
              label="Last refreshed"
              value={formatDateTime(game.lastRefreshedAt)}
            />
            <div className="flex flex-col gap-1 text-sm">
              <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Publisher
              </dt>
              <dd>
                {game.publisherRecord ? (
                  <Link
                    href={`/admin/publishers/${game.publisherRecord.id}`}
                    className="text-primary hover:underline"
                  >
                    {game.publisherRecord.name}
                  </Link>
                ) : (
                  <span>{game.publisher ?? '—'}</span>
                )}
              </dd>
              {game.publisherRecord && (
                <dd className="mt-1">
                  <LauncherProfileBadge
                    profile={game.publisherRecord.launcherProfile}
                  />
                </dd>
              )}
            </div>
          </dl>
          {game.summary && (
            <p className="text-muted-foreground text-sm leading-relaxed">
              {game.summary}
            </p>
          )}
          <EditGameForm
            initial={{
              id: game.id,
              name: game.name,
              releaseDate: game.releaseDate,
              igdbId: game.igdbId,
              calibratedMultiplier: game.calibratedMultiplier,
              calibratedPsMultiplier: game.calibratedPsMultiplier,
              calibratedXboxMultiplier: game.calibratedXboxMultiplier,
              calibrationSourcePc: game.calibrationSourcePc,
              calibrationSourcePs: game.calibrationSourcePs,
              calibrationSourceXbox: game.calibrationSourceXbox,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold tracking-wide uppercase">
            Current estimate
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {latestSnapshot ? (
            <>
              <p className="text-primary text-5xl font-bold tracking-tight tabular-nums">
                {formatRange(
                  latestSnapshot.estimatedTodayLow,
                  latestSnapshot.estimatedTodayHigh,
                )}
              </p>
              <p className="text-muted-foreground text-sm">
                units · from latest snapshot{' '}
                {formatDateTime(latestSnapshot.computedAt)}
              </p>
              <p className="text-muted-foreground text-xs tabular-nums">
                {latestSnapshot.estimatedTodayLow.toLocaleString()} –{' '}
                {latestSnapshot.estimatedTodayHigh.toLocaleString()} units
              </p>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              No snapshot yet. Trigger a refresh to compute the headline
              estimate.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold tracking-wide uppercase">
            Estimated sales over time ({game.estimateSnapshots.length}{' '}
            snapshots)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <EstimateHistoryChart snapshots={game.estimateSnapshots} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold tracking-wide uppercase">
            Steam concurrent players over time
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <CcuHistoryChart signals={game.signals} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold tracking-wide uppercase">
            Calculation methods ({game.estimates.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 p-0">
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
          <MethodLegend className="px-6 pb-6" />
        </CardContent>
      </Card>

      <Tabs defaultValue="sales" className="gap-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="sales">
            Sales records ({game.salesRecords.length})
          </TabsTrigger>
          <TabsTrigger value="achievements">
            Achievements ({game.achievementSnapshots.length})
          </TabsTrigger>
          <TabsTrigger value="signals">
            Signals ({game.signals.length})
          </TabsTrigger>
          <TabsTrigger value="sources">
            External sources ({game.sources.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sales">
          <Card>
            <CardContent className="p-0">
              {game.salesRecords.length === 0 ? (
                <p className="text-muted-foreground p-6 text-sm">
                  No sales records yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source tier</TableHead>
                      <TableHead>Reported by</TableHead>
                      <TableHead>Attribution</TableHead>
                      <TableHead>Platform</TableHead>
                      <TableHead className="text-right">Units</TableHead>
                      <TableHead>Reported</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {game.salesRecords.map((sr) => (
                      <TableRow key={sr.id}>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge variant="outline">{sr.source}</Badge>
                            {sr.confidence && (
                              <Badge
                                variant="outline"
                                className="text-[10px] tracking-wide uppercase opacity-70"
                              >
                                {sr.confidence}
                              </Badge>
                            )}
                            {sr.isEngagement && (
                              <Badge
                                variant="secondary"
                                className="border-amber-300 bg-amber-100 text-[10px] tracking-wide text-amber-800 uppercase dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
                                title="Players-reached / engagement milestone (includes subscription users like Ubisoft+/Game Pass). Excluded from estimation."
                              >
                                Engagement
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {sr.sourceUrl ? (
                            <a
                              href={sr.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={sr.sourceUrl}
                              className="text-primary inline-flex max-w-[200px] items-center gap-1 truncate text-xs hover:underline"
                            >
                              {hostnameOf(sr.sourceUrl)}
                              <ExternalLink
                                aria-hidden="true"
                                className="size-3 shrink-0"
                              />
                            </a>
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell
                          className="text-muted-foreground max-w-[160px] truncate text-sm"
                          title={sr.publisher ?? undefined}
                        >
                          {sr.publisher ?? '—'}
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
                        <TableCell
                          className="text-muted-foreground max-w-xs truncate text-xs"
                          title={sr.note ?? undefined}
                        >
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
        </TabsContent>

        <TabsContent value="achievements">
          <Card>
            <CardContent className="p-0">
              {game.achievementSnapshots.length === 0 ? (
                <p className="text-muted-foreground p-6 text-sm">
                  No achievement data captured yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Platform</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">
                        Achievements
                      </TableHead>
                      <TableHead className="text-right">
                        Players tracked
                      </TableHead>
                      <TableHead>Most common</TableHead>
                      <TableHead className="text-right">%</TableHead>
                      <TableHead className="text-right">Players</TableHead>
                      <TableHead>Captured</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {game.achievementSnapshots.map((a) => (
                      <TableRow key={`${a.platform}-${a.source}`}>
                        <TableCell>
                          <Badge variant="secondary">{a.platform}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {a.source}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {a.achievementsCount.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {a.playersTracked !== null
                            ? a.playersTracked.toLocaleString()
                            : '—'}
                        </TableCell>
                        <TableCell className="max-w-[260px] truncate text-xs">
                          {a.mostCommonName}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {a.mostCommonPercent.toFixed(2)}%
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {a.mostCommonPlayers !== null
                            ? a.mostCommonPlayers.toLocaleString()
                            : '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {formatDateTime(a.capturedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="signals">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold tracking-wide uppercase">
                Signal snapshots (last 200)
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
        </TabsContent>

        <TabsContent value="sources">
          <Card>
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
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MethodLegend({ className }: { className?: string }) {
  const entries: { tag: string; description: string }[] = [
    {
      tag: 'boxleiter',
      description:
        'PC estimate: Steam reviews × Boxleiter multiplier. Default range when no calibration is available.',
    },
    {
      tag: 'ps-ratings-boxleiter',
      description:
        'PlayStation estimate: PSN ratings × Boxleiter-style multiplier.',
    },
    {
      tag: 'xbox-ratings-boxleiter',
      description: 'Xbox estimate: Xbox ratings × Boxleiter-style multiplier.',
    },
    {
      tag: '…-calibrated-{source}',
      description:
        'Multiplier is calibrated from a known sales record (OFFICIAL / ANNOUNCEMENT / MEDIA / WIKIPEDIA). Spread varies with source confidence.',
    },
    {
      tag: '…-default',
      description:
        'No calibrated multiplier: uses the platform default range with a wider spread.',
    },
    {
      tag: '…+ccu',
      description:
        'Suffix added when peak concurrent users (Steam CCU) raises or constrains the estimate.',
    },
    {
      tag: '…+launcher-{profile}',
      description:
        'Suffix added when the publisher launcher profile (e.g. Steam-only vs multi-store) shifts the multiplier.',
    },
  ];

  return (
    <div className={cn('flex flex-col gap-2 text-xs', className)}>
      <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
        Method legend
      </p>
      <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {entries.map((entry) => (
          <div key={entry.tag} className="flex flex-col gap-0.5">
            <dt className="font-mono text-[11px]">{entry.tag}</dt>
            <dd className="text-muted-foreground">{entry.description}</dd>
          </div>
        ))}
      </dl>
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

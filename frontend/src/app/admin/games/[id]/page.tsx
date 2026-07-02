import Link from 'next/link';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import {
  adminFetch,
  type AdminEstimate,
  type AdminEstimateSnapshot,
  type AdminGameDetail,
  type AdminMatcherInspection,
  type AdminPriceSnapshot,
} from '@/lib/admin';
import { cn } from '@/lib/utils';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { RebuildEstimatesButton } from '../../_components/RebuildEstimatesButton';
import { ImportCcuCsvButton } from '../../_components/ImportCcuCsvButton';
import { ImportReviewsCsvButton } from '../../_components/ImportReviewsCsvButton';
import { EditGameForm } from '../../_components/EditGameForm';
import { EstimateHistoryChart } from '../../_components/EstimateHistoryChart';
import { CcuHistoryChart } from '../../_components/CcuHistoryChart';
import { ReviewHistoryChart } from '../../_components/ReviewHistoryChart';
import { SteamShareBadge } from '../../_components/SteamShareBadge';
import { EstimateBreakdownPanel } from '../../_components/EstimateBreakdownPanel';
import { deleteGame, deleteMilestone, deleteSignal } from '../../actions';

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

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(cents / 100);
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

// Estimates produced in a single run share the same `computedAt` (down
// to a few ms of drift between the base / aggregate / split saves on the
// live path). Group everything within this window of the most recent
// estimate as "the latest batch" — the methods that actually fed the
// current headline snapshot.
const BATCH_WINDOW_MS = 15_000;

const PLATFORM_ORDER = ['PC', 'PLAYSTATION', 'XBOX', 'SWITCH', 'GLOBAL'];

function platformRank(platform: string): number {
  const i = PLATFORM_ORDER.indexOf(platform);
  return i === -1 ? PLATFORM_ORDER.length : i;
}

interface PlatformGroup {
  platform: string;
  aggregate: AdminEstimate | null;
  methods: AdminEstimate[];
}

/**
 * Split the flat estimate list into the most recent batch (what built the
 * current snapshot) and everything older, then group the latest batch by
 * platform with the `aggregated` consensus row pulled aside.
 */
function buildLatestBatch(estimates: AdminEstimate[]): {
  computedAt: string | null;
  groups: PlatformGroup[];
  olderCount: number;
} {
  if (estimates.length === 0) {
    return { computedAt: null, groups: [], olderCount: 0 };
  }

  const maxTs = Math.max(
    ...estimates.map((e) => new Date(e.computedAt).getTime()),
  );
  const latest: AdminEstimate[] = [];
  let olderCount = 0;
  for (const e of estimates) {
    if (maxTs - new Date(e.computedAt).getTime() <= BATCH_WINDOW_MS) {
      latest.push(e);
    } else {
      olderCount += 1;
    }
  }

  const byPlatform = new Map<string, PlatformGroup>();
  for (const e of latest) {
    const group =
      byPlatform.get(e.platform) ??
      ({ platform: e.platform, aggregate: null, methods: [] } as PlatformGroup);
    if (e.method === 'aggregated') {
      group.aggregate = e;
    } else {
      group.methods.push(e);
    }
    byPlatform.set(e.platform, group);
  }

  const groups = [...byPlatform.values()].sort(
    (a, b) => platformRank(a.platform) - platformRank(b.platform),
  );
  for (const g of groups) {
    g.methods.sort((a, b) => a.method.localeCompare(b.method));
  }

  return {
    computedAt: new Date(maxTs).toISOString(),
    groups,
    olderCount,
  };
}

const AGREEMENT_STYLE: Record<
  'strong' | 'weak' | 'conflict',
  { label: string; className: string }
> = {
  strong: {
    label: 'Strong',
    className:
      'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
  },
  weak: {
    label: 'Weak',
    className:
      'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
  },
  conflict: {
    label: 'Conflict',
    className:
      'border-red-300 bg-red-100 text-red-800 dark:border-red-700 dark:bg-red-900/40 dark:text-red-200',
  },
};

function AgreementBadge({
  agreement,
}: {
  agreement: 'strong' | 'weak' | 'conflict';
}) {
  const style = AGREEMENT_STYLE[agreement];
  return (
    <Badge
      variant="outline"
      className={cn('text-[10px] tracking-wide uppercase', style.className)}
    >
      {style.label}
    </Badge>
  );
}

export default async function AdminGameDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [game, matcher] = await Promise.all([
    adminFetch<AdminGameDetail>(`/games/${id}`),
    adminFetch<AdminMatcherInspection | null>(`/games/${id}/matcher`).catch(
      () => null,
    ),
  ]);

  const latestSnapshot =
    game.estimateSnapshots.length > 0
      ? game.estimateSnapshots[game.estimateSnapshots.length - 1]
      : null;

  const pricesDesc = [...game.prices].sort(
    (a, b) =>
      new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
  );
  const currentPrice = pricesDesc[0] ?? null;

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
            {game.liveService && (
              <Badge variant="outline">Live-service</Badge>
            )}
            {game.isAnnualIteration && (
              <Badge variant="outline">Annual iteration</Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RefreshGameButton gameId={game.id} />
          <RebuildEstimatesButton gameId={game.id} />
          <ImportCcuCsvButton gameId={game.id} />
          <ImportReviewsCsvButton gameId={game.id} />
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
            <Field label="Developer" value={game.developer ?? '—'} />
            <Field
              label="Franchise"
              value={game.franchiseSlug ?? '—'}
              mono
            />
            <Field
              label="Iteration"
              value={game.iterationNumber?.toString() ?? '—'}
            />
            <Field
              label="DLC"
              value={game.dlc.length > 0 ? game.dlc.length.toString() : '—'}
            />
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
                Genres
              </dt>
              <dd>
                {game.genres.length === 0 ? (
                  '—'
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {game.genres.map((g) => (
                      <Badge key={g} variant="outline">
                        {g}
                      </Badge>
                    ))}
                  </div>
                )}
              </dd>
            </div>
            <div className="flex flex-col gap-1 text-sm">
              <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Categories
              </dt>
              <dd>
                {game.categories.length === 0 ? (
                  '—'
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {game.categories.map((c) => (
                      <Badge key={c} variant="outline">
                        {c}
                      </Badge>
                    ))}
                  </div>
                )}
              </dd>
            </div>
            <div className="flex flex-col gap-1 text-sm">
              <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Steam tags
              </dt>
              <dd>
                {game.steamTags.length === 0 ? (
                  '—'
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {game.steamTags.map((t) => (
                      <Badge key={t} variant="secondary">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </dd>
            </div>
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
                  <SteamShareBadge
                    low={game.publisherRecord.steamSharePctLow}
                    high={game.publisherRecord.steamSharePctHigh}
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
            Latest snapshot
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {latestSnapshot ? (
            <>
              <SnapshotHeadline snapshot={latestSnapshot} />
              <SnapshotReconciliation snapshot={latestSnapshot} />
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              No snapshot yet. Trigger a refresh to compute the headline
              estimate.
            </p>
          )}
        </CardContent>
      </Card>

      {matcher && <MatcherCard matcher={matcher} />}

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
          <CcuHistoryChart
            ccuHistory={game.ccuHistory}
            peak={game.allTimePeakCcu}
            peakAt={game.allTimePeakCcuAt}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold tracking-wide uppercase">
            Steam reviews over time
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ReviewHistoryChart reviewHistory={game.reviewHistory} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <CardTitle className="text-sm font-semibold tracking-wide uppercase">
            Steam price history ({pricesDesc.length})
          </CardTitle>
          {currentPrice && <CurrentPrice price={currentPrice} />}
        </CardHeader>
        <CardContent className="p-0">
          {pricesDesc.length === 0 ? (
            <p className="text-muted-foreground p-6 text-sm">
              No price snapshots yet. They will be captured on the next daily
              run (the cron polls the Steam store price for every tracked
              Steam app).
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Captured</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Regular</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pricesDesc.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDateTime(p.capturedAt)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMoney(p.final, p.currency)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">
                      {p.discountPercent > 0
                        ? formatMoney(p.initial, p.currency)
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.discountPercent > 0 ? (
                        <Badge
                          variant="secondary"
                          className="border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
                        >
                          -{p.discountPercent}%
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <MethodsCard estimates={game.estimates} />

      <EstimateBreakdownPanel gameId={game.id} />

      <Tabs defaultValue="sales" className="gap-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="sales">
            Milestones ({game.milestones.length})
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
              {game.milestones.length === 0 ? (
                <p className="text-muted-foreground p-6 text-sm">
                  No milestones yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source tier</TableHead>
                      <TableHead>Reported by</TableHead>
                      <TableHead>Attribution</TableHead>
                      <TableHead className="text-right">Units</TableHead>
                      <TableHead className="text-right">Confidence</TableHead>
                      <TableHead>Reported</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {game.milestones.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge variant="outline">{m.source}</Badge>
                            {m.region === 'PC' && (
                              <Badge
                                variant="secondary"
                                className="border-sky-300 bg-sky-100 text-[10px] tracking-wide text-sky-800 uppercase dark:border-sky-700 dark:bg-sky-900/40 dark:text-sky-200"
                                title="PC-only sales figure (e.g. copies sold on Steam). Stored for analysis; not yet fed into the GLOBAL→platform calibration."
                              >
                                PC
                              </Badge>
                            )}
                            {m.isEngagement && (
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
                          {m.sourceUrl ? (
                            <a
                              href={m.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={m.sourceUrl}
                              className="text-primary inline-flex max-w-[200px] items-center gap-1 truncate text-xs hover:underline"
                            >
                              {hostnameOf(m.sourceUrl)}
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
                          title={m.publisher ?? undefined}
                        >
                          {m.publisher ?? '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {m.units.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                          {m.confidenceScore == null
                            ? '—'
                            : Math.round(m.confidenceScore)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatDate(m.reportedAt)}
                        </TableCell>
                        <TableCell
                          className="text-muted-foreground max-w-xs truncate text-xs"
                          title={m.note ?? undefined}
                        >
                          {m.note ?? '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <DeleteButton
                            action={deleteMilestone.bind(null, m.id)}
                            confirmMessage="Delete this milestone?"
                            iconOnly
                            label="Delete milestone"
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
                      <TableHead className="text-right">Actions</TableHead>
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
                        <TableCell className="text-right">
                          <DeleteButton
                            action={deleteSignal.bind(null, s.id, game.id)}
                            confirmMessage="Delete this signal snapshot?"
                            iconOnly
                            label="Delete signal"
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

function MatcherCard({ matcher }: { matcher: AdminMatcherInspection }) {
  const { resolved } = matcher;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="text-sm font-semibold tracking-wide uppercase">
            Data-driven matcher
          </CardTitle>
          <CardDescription>
            Nearest anchors in the reference corpus and the profile they resolve
            to. This is what the estimation model consumes when the matcher is
            on.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={matcher.matcherEnabled ? 'default' : 'outline'}>
            Matcher {matcher.matcherEnabled ? 'on' : 'off'}
          </Badge>
          {matcher.isAnchor && <Badge variant="secondary">Is anchor</Badge>}
          <Badge variant={matcher.coldStart ? 'destructive' : 'outline'}>
            {matcher.coldStart ? 'Cold-start (baseline)' : 'Matched'}
          </Badge>
          <Badge variant="outline">{matcher.neighboursUsed} neighbours</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MatcherStat
            label="Reviews→units"
            value={
              matcher.reviewsToUnits !== null
                ? matcher.reviewsToUnits.toFixed(1)
                : '—'
            }
          />
          <MatcherStat
            label="m1 (×Y1)"
            value={
              resolved
                ? `×${resolved.firstWeekToYearOneMultiplier.toFixed(2)}`
                : '—'
            }
          />
          <MatcherStat
            label="Y2 retention"
            value={resolved ? resolved.year2Retention : '—'}
          />
          <MatcherStat
            label="PC Boxleiter"
            value={
              resolved &&
              resolved.pcDefaultBoxleiterLow !== null &&
              resolved.pcDefaultBoxleiterHigh !== null
                ? `${resolved.pcDefaultBoxleiterLow.toFixed(1)}–${resolved.pcDefaultBoxleiterHigh.toFixed(1)}`
                : '—'
            }
          />
          <MatcherStat
            label="PS Boxleiter"
            value={
              resolved &&
              resolved.psDefaultBoxleiterLow !== null &&
              resolved.psDefaultBoxleiterHigh !== null
                ? `${resolved.psDefaultBoxleiterLow.toFixed(1)}–${resolved.psDefaultBoxleiterHigh.toFixed(1)}`
                : '—'
            }
          />
          <MatcherStat
            label="CCU→W1"
            value={
              matcher.peakCcuRatio !== null
                ? `×${matcher.peakCcuRatio.toFixed(1)}`
                : '—'
            }
          />
          <MatcherStat
            label="CCU→W1 band"
            value={
              resolved
                ? `${resolved.peakCcuToWeekOneLow.toFixed(1)}–${resolved.peakCcuToWeekOneHigh.toFixed(1)}`
                : '—'
            }
          />
        </div>

        {resolved && (
          <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-xs tabular-nums">
            <span>PC {(resolved.pcShare * 100).toFixed(0)}%</span>
            <span>PS {(resolved.playstationShare * 100).toFixed(0)}%</span>
            <span>Xbox {(resolved.xboxShare * 100).toFixed(0)}%</span>
            <span>Switch {(resolved.switchShare * 100).toFixed(0)}%</span>
            <span>
              tail Y2 ×{resolved.tailFactorY2.toFixed(2)} · Y5 ×
              {resolved.tailFactorY5.toFixed(2)}
            </span>
          </div>
        )}

        {matcher.anchorProfile && (
          <AnchorProfilePanel anchor={matcher.anchorProfile} matcher={matcher} />
        )}

        {matcher.neighbours.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Anchor</TableHead>
                <TableHead
                  className="text-right"
                  title="Feature similarity in [0,1]"
                >
                  Similarity
                </TableHead>
                <TableHead
                  className="text-right"
                  title="similarity × anchor quality score (aggregation weight)"
                >
                  Weight
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matcher.neighbours.map((n) => (
                <TableRow key={n.gameId}>
                  <TableCell>
                    <Link
                      href={`/admin/games/${n.gameId}`}
                      className="text-primary text-sm hover:underline"
                    >
                      {n.gameName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {n.similarity.toFixed(3)}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {n.weight.toFixed(3)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground text-sm">
            No neighbours found — this game is cold-start. The matcher emits no
            profile, so the estimation falls back to the model&apos;s global
            constant multipliers and shares.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MatcherStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
        {label}
      </span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function AnchorProfilePanel({
  anchor,
  matcher,
}: {
  anchor: NonNullable<AdminMatcherInspection['anchorProfile']>;
  matcher: AdminMatcherInspection;
}) {
  const rows: Array<{
    label: string;
    observed: number | null;
    aggregate: number | null;
    format: (v: number) => string;
  }> = [
    {
      label: 'Reviews→units',
      observed: anchor.reviewsToUnits,
      aggregate: matcher.reviewsToUnits,
      format: (v) => v.toFixed(1),
    },
    {
      label: 'CCU→W1 ratio',
      observed: anchor.peakCcuRatio,
      aggregate: matcher.peakCcuRatio,
      format: (v) => `×${v.toFixed(1)}`,
    },
    {
      label: 'Curve s1',
      observed: anchor.curve.s1,
      aggregate: matcher.curve.s1,
      format: (v) => v.toFixed(2),
    },
    {
      label: 'Curve m1',
      observed: anchor.curve.m1,
      aggregate: matcher.curve.m1,
      format: (v) => v.toFixed(2),
    },
    {
      label: 'Curve m3',
      observed: anchor.curve.m3,
      aggregate: matcher.curve.m3,
      format: (v) => v.toFixed(2),
    },
    {
      label: 'Curve m6',
      observed: anchor.curve.m6,
      aggregate: matcher.curve.m6,
      format: (v) => v.toFixed(2),
    },
    {
      label: 'Curve a1',
      observed: anchor.curve.a1,
      aggregate: matcher.curve.a1,
      format: (v) => v.toFixed(2),
    },
    {
      label: 'Curve a2',
      observed: anchor.curve.a2,
      aggregate: matcher.curve.a2,
      format: (v) => v.toFixed(2),
    },
  ];

  return (
    <div className="border-border/60 bg-muted/30 flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold tracking-wide uppercase">
          Observed anchor vector (this game)
        </h4>
        <span className="text-muted-foreground text-[11px] tabular-nums">
          scale{' '}
          {anchor.scaleUnits !== null
            ? formatUnitsCompact(anchor.scaleUnits)
            : '—'}{' '}
          · quality{' '}
          {anchor.qualityScore.toFixed(2)} · observed{' '}
          {formatDate(anchor.observedAt)}
        </span>
      </div>
      <p className="text-muted-foreground text-xs">
        This game&apos;s own measured ratios. Compare them against the matcher
        aggregate (from its neighbours) — a large gap here is the usual reason an
        anchor&apos;s estimate diverges from its real numbers.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Metric</TableHead>
            <TableHead className="text-right">Observed</TableHead>
            <TableHead className="text-right">Matcher aggregate</TableHead>
            <TableHead className="text-right">Δ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const delta =
              r.observed !== null &&
              r.aggregate !== null &&
              r.aggregate !== 0
                ? (r.observed - r.aggregate) / Math.abs(r.aggregate)
                : null;
            return (
              <TableRow key={r.label}>
                <TableCell className="text-sm">{r.label}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {r.observed !== null ? r.format(r.observed) : '—'}
                </TableCell>
                <TableCell className="text-muted-foreground text-right text-xs tabular-nums">
                  {r.aggregate !== null ? r.format(r.aggregate) : '—'}
                </TableCell>
                <TableCell
                  className={`text-right text-xs tabular-nums ${
                    delta !== null && Math.abs(delta) >= 0.25
                      ? 'text-destructive font-medium'
                      : 'text-muted-foreground'
                  }`}
                >
                  {delta !== null
                    ? `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(0)}%`
                    : '—'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {anchor.platformShares && (
        <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-xs tabular-nums">
          <span>Observed shares:</span>
          <span>PC {(anchor.platformShares.pc * 100).toFixed(0)}%</span>
          <span>PS {(anchor.platformShares.ps * 100).toFixed(0)}%</span>
          <span>Xbox {(anchor.platformShares.xbox * 100).toFixed(0)}%</span>
          <span>Switch {(anchor.platformShares.switch * 100).toFixed(0)}%</span>
        </div>
      )}
    </div>
  );
}

function CurrentPrice({ price }: { price: AdminPriceSnapshot }) {
  const onSale = price.discountPercent > 0;
  return (
    <div className="flex items-center gap-2 text-right">
      <div className="flex flex-col items-end">
        <span className="text-xl font-bold tabular-nums">
          {formatMoney(price.final, price.currency)}
        </span>
        {onSale && (
          <span className="text-muted-foreground text-xs tabular-nums line-through">
            {formatMoney(price.initial, price.currency)}
          </span>
        )}
        <span className="text-muted-foreground text-[11px]">
          {formatDate(price.capturedAt)}
        </span>
      </div>
      {onSale && (
        <Badge
          variant="secondary"
          className="border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
        >
          -{price.discountPercent}%
        </Badge>
      )}
    </div>
  );
}

function SnapshotHeadline({ snapshot }: { snapshot: AdminEstimateSnapshot }) {
  const reconciledMid =
    (snapshot.estimatedTodayLow + snapshot.estimatedTodayHigh) / 2;
  const hasPure =
    snapshot.pureEstimatedTodayLow !== null &&
    snapshot.pureEstimatedTodayHigh !== null;
  const pureMid = hasPure
    ? ((snapshot.pureEstimatedTodayLow as number) +
        (snapshot.pureEstimatedTodayHigh as number)) /
      2
    : null;
  const deltaPct =
    pureMid !== null && reconciledMid > 0
      ? ((pureMid - reconciledMid) / reconciledMid) * 100
      : null;
  const deltaTone =
    deltaPct === null || Math.abs(deltaPct) <= 10
      ? 'text-muted-foreground'
      : deltaPct > 0
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-blue-600 dark:text-blue-400';

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div className="flex flex-col gap-1">
        <p className="text-primary text-4xl font-bold tracking-tight tabular-nums">
          {formatRange(
            snapshot.estimatedTodayLow,
            snapshot.estimatedTodayHigh,
          )}
        </p>
        <p className="text-muted-foreground text-[11px] tracking-wide uppercase">
          Reconciled headline · with declared figures
        </p>
        <p className="text-muted-foreground text-xs tabular-nums">
          {snapshot.estimatedTodayLow.toLocaleString()} –{' '}
          {snapshot.estimatedTodayHigh.toLocaleString()} units
        </p>
        <p className="text-muted-foreground text-xs">
          {formatDateTime(snapshot.computedAt)}
        </p>
      </div>

      <div className="border-muted bg-muted/20 flex flex-col gap-1 rounded-md border p-3">
        {hasPure ? (
          <>
            <p className="text-foreground text-3xl font-semibold tracking-tight tabular-nums">
              {formatRange(
                snapshot.pureEstimatedTodayLow as number,
                snapshot.pureEstimatedTodayHigh as number,
              )}
            </p>
            <p className="text-muted-foreground text-[11px] tracking-wide uppercase">
              Pure algo · no declared figures
            </p>
            <p className="text-muted-foreground text-xs tabular-nums">
              {(
                snapshot.pureEstimatedTodayLow as number
              ).toLocaleString()}{' '}
              –{' '}
              {(
                snapshot.pureEstimatedTodayHigh as number
              ).toLocaleString()}{' '}
              units
            </p>
            {deltaPct !== null && (
              <p className={cn('text-xs tabular-nums', deltaTone)}>
                Δ vs reconciled: {deltaPct >= 0 ? '+' : ''}
                {deltaPct.toFixed(1)}%
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-muted-foreground text-3xl font-semibold tracking-tight">
              —
            </p>
            <p className="text-muted-foreground text-[11px] tracking-wide uppercase">
              Pure algo · no declared figures
            </p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Not computed for this snapshot. Refresh the game to populate
              both ranges on the next run.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function SnapshotReconciliation({
  snapshot,
}: {
  snapshot: AdminEstimateSnapshot;
}) {
  if (snapshot.reconciliation.length === 0) {
    return (
      <div className="border-muted bg-muted/30 rounded-md border p-4 text-sm">
        <p className="text-muted-foreground">
          No declared sales figure to cross-check against. The headline is the
          pure <span className="font-mono text-xs">aggregated</span> estimate —
          the weighted blend of every enabled method per platform (see{' '}
          <em>Calculation methods</em> below).
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
        How the headline reconciles with declared figures
      </p>
      <div className="flex flex-col gap-3">
        {snapshot.reconciliation.map((r) => (
          <div
            key={`${r.platform}-${r.declaredSource}-${r.declaredAt}`}
            className="border-muted rounded-md border p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{r.platform}</Badge>
              <AgreementBadge agreement={r.agreement} />
              <span className="text-muted-foreground text-xs tabular-nums">
                ratio ×{r.ratio.toFixed(2)}
              </span>
            </div>
            <div className="mt-2 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <div className="flex flex-col gap-0.5">
                <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
                  Declared
                </span>
                <span className="tabular-nums">
                  {r.declaredUnits.toLocaleString()} units
                </span>
                <span className="text-muted-foreground text-xs">
                  {r.declaredSource}
                  {r.declaredAt ? ` · ${formatDate(r.declaredAt)}` : ''}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
                  Our estimate
                </span>
                <span className="tabular-nums">
                  {r.estimateLow.toLocaleString()} –{' '}
                  {r.estimateHigh.toLocaleString()} units
                </span>
                <span className="text-muted-foreground font-mono text-[11px]">
                  {r.estimateMethod}
                </span>
              </div>
            </div>
            {r.detail && (
              <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                {r.detail}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MethodsCard({ estimates }: { estimates: AdminEstimate[] }) {
  const { computedAt, groups, olderCount } = buildLatestBatch(estimates);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold tracking-wide uppercase">
          Calculation methods
        </CardTitle>
        {computedAt && (
          <p className="text-muted-foreground text-xs">
            Latest batch · {formatDateTime(computedAt)} · {groups.length}{' '}
            platform{groups.length > 1 ? 's' : ''}
          </p>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-6 p-0">
        {groups.length === 0 ? (
          <p className="text-muted-foreground p-6 text-sm">No estimates yet.</p>
        ) : (
          <div className="flex flex-col gap-6 px-6">
            {groups.map((group) => (
              <PlatformMethodGroup key={group.platform} group={group} />
            ))}
          </div>
        )}

        {olderCount > 0 && (
          <details className="px-6">
            <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs">
              Show full history ({olderCount} older row
              {olderCount > 1 ? 's' : ''})
            </summary>
            <div className="mt-3">
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
                  {estimates.map((e) => (
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
            </div>
          </details>
        )}

        <MethodLegend className="px-6 pb-6" />
      </CardContent>
    </Card>
  );
}

function PlatformMethodGroup({ group }: { group: PlatformGroup }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{group.platform}</Badge>
          <span className="text-muted-foreground text-xs">
            {group.methods.length} method
            {group.methods.length > 1 ? 's' : ''} → consensus
          </span>
        </div>
        {group.aggregate ? (
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="outline">{group.aggregate.confidence}</Badge>
            <span className="font-semibold tabular-nums">
              {group.aggregate.estimatedLow.toLocaleString()} –{' '}
              {group.aggregate.estimatedHigh.toLocaleString()}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground text-xs italic">
            no aggregate row
          </span>
        )}
      </div>

      {group.methods.length === 0 ? (
        <p className="text-muted-foreground py-2 text-xs">
          Only an aggregate row — no individual method contributed.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Method</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead className="text-right">Low</TableHead>
              <TableHead className="text-right">High</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {group.methods.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-mono text-xs">{e.method}</TableCell>
                <TableCell>
                  <Badge variant="outline">{e.confidence}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {e.estimatedLow.toLocaleString()}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {e.estimatedHigh.toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function MethodLegend({ className }: { className?: string }) {
  const entries: { tag: string; description: string }[] = [
    {
      tag: 'boxleiter',
      description:
        'PC estimate: Steam reviews × Boxleiter multiplier. The default range is derived by the data-driven matcher (reviews→units of the nearest anchors) when no per-game calibration is available.',
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
      tag: 'first-week-extrapolation-pc',
      description:
        'PC lifecycle method: week-1 units from peak CCU (and launch reviews) projected to today via a degressive curve built from the matcher profile (m1 + tail factors).',
    },
    {
      tag: 'genre-console-split-from-{source}-{target}',
      description:
        'Console estimate ventilated from the PC (or PS) aggregate using the matcher-derived platform shares (targetShare ÷ sourceShare).',
    },
    {
      tag: 'aggregated',
      description:
        'Consensus per platform: confidence-weighted blend of every enabled method, widened when methods disagree.',
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

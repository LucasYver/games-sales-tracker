import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  adminFetch,
  type AdminGamePageSummary,
  type AdminGameChartsData,
  type AdminMatcherInspection,
  type AdminEstimateBreakdown,
} from '@/lib/admin';
import type { Platform } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
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
import { GameTabNav } from '../../_components/GameTabNav';
import { DeleteButton } from '../../_components/DeleteButton';
import { RefreshGameButton } from '../../_components/RefreshGameButton';
import { RebuildEstimatesButton } from '../../_components/RebuildEstimatesButton';
import { ImportCcuCsvButton } from '../../_components/ImportCcuCsvButton';
import { ImportReviewsCsvButton } from '../../_components/ImportReviewsCsvButton';
import { EditGameForm } from '../../_components/EditGameForm';
import { MilestoneRow } from '../../_components/MilestoneRow';
import { CcuHistoryChart } from '../../_components/CcuHistoryChart';
import { ReviewHistoryChart } from '../../_components/ReviewHistoryChart';
import { FollowersHistoryChart } from '../../_components/FollowersHistoryChart';
import { TwitchViewersHistoryChart } from '../../_components/TwitchViewersHistoryChart';
import { EstimateBreakdownView } from '../../_components/EstimateBreakdownPanel';
import { deleteGame, setReferenceExclusion } from '../../actions';

export const dynamic = 'force-dynamic';

// ─── helpers ────────────────────────────────────────────────────────────────

function compact(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return `${n}`;
}

// The headline number for an estimate is always the midpoint of its [low, high]
// band — a single number == the range's high would systematically overstate.
function midpoint(low: number, high: number): number {
  return (low + high) / 2;
}
function compactMid(low: number, high: number): string {
  return compact(midpoint(low, high));
}
function fmtRange(low: number, high: number): string {
  return `${compact(low)}–${compact(high)}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function latest(summary: AdminGamePageSummary, metric: string): number | null {
  return summary.latestSignals.find((s) => s.metric === metric)?.value ?? null;
}

// ─── page ─────────────────────────────────────────────────────────────────

export default async function AdminGameDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab = tabParam ?? 'overview';

  const s = await adminFetch<AdminGamePageSummary>(`/games/${id}/summary`);
  const has = (p: Platform) => s.platforms.includes(p);

  const estToday = s.latestEstimate;
  const topMilestone = s.milestones.reduce<number | null>(
    (max, m) => (m.units > (max ?? 0) ? m.units : max),
    null,
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
      <Button asChild variant="ghost" size="sm" className="-ml-3 self-start">
        <Link href="/admin/games">
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back to games
        </Link>
      </Button>

      {/* ── Cover banner ── */}
      <div className="border-border relative overflow-hidden rounded-xl border">
        <div
          className="h-40 bg-cover bg-center"
          style={{
            backgroundImage: s.coverUrl
              ? `linear-gradient(to top, rgba(10,10,16,.85), rgba(10,10,16,.15)), url(${s.coverUrl})`
              : 'linear-gradient(120deg,#3b2a6b,#5b3aa6 42%,#b3477e)',
          }}
        />
        <div className="absolute inset-x-4 bottom-3 flex items-end justify-between gap-4">
          <div className="flex items-end gap-3">
            {s.coverUrl && (
              <div
                className="size-16 shrink-0 rounded-lg border border-white/20 bg-cover bg-center shadow-lg"
                style={{ backgroundImage: `url(${s.coverUrl})` }}
              />
            )}
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white drop-shadow">
                {s.name}
              </h1>
              <p className="font-mono text-[11px] text-white/70">{s.id}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {s.platforms.map((p) => (
                  <Badge
                    key={p}
                    className="border-transparent bg-white/90 text-[10px] text-neutral-900"
                  >
                    {p}
                  </Badge>
                ))}
                {s.isFree && (
                  <Badge className="border-white/30 bg-white/15 text-[10px] text-white">
                    Free-to-play
                  </Badge>
                )}
                {s.liveService && (
                  <Badge className="border-white/30 bg-white/15 text-[10px] text-white">
                    Live-service
                  </Badge>
                )}
                {s.isAnnualIteration && (
                  <Badge className="border-white/30 bg-white/15 text-[10px] text-white">
                    Annual iteration
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <RefreshGameButton gameId={s.id} />
            <RebuildEstimatesButton gameId={s.id} />
            <ImportCcuCsvButton gameId={s.id} />
            <ImportReviewsCsvButton gameId={s.id} />
            <DeleteButton
              action={deleteGame.bind(null, s.id)}
              confirmMessage={`Permanently delete "${s.name}"?`}
              label="Delete"
            />
          </div>
        </div>
      </div>

      {/* ── KPI strip ── */}
      <div className="border-border grid grid-cols-2 divide-x divide-y overflow-hidden rounded-xl border sm:grid-cols-5 sm:divide-y-0">
        <Kpi
          label="Est. today"
          value={
            estToday
              ? compactMid(
                  estToday.estimatedTodayLow,
                  estToday.estimatedTodayHigh,
                )
              : '—'
          }
          hint={
            estToday
              ? fmtRange(
                  estToday.estimatedTodayLow,
                  estToday.estimatedTodayHigh,
                )
              : 'no snapshot'
          }
        />
        <Kpi
          label="Milestone"
          value={compact(topMilestone)}
          hint={`${s.milestonesCount} declared`}
        />
        <Kpi
          label="Steam reviews"
          value={compact(latest(s, 'STEAM_REVIEWS'))}
          hint={fmtDate(s.releaseDate)}
        />
        <Kpi
          label="Peak CCU"
          value={compact(s.peakCcu?.value ?? null)}
          hint={s.peakCcu ? fmtDate(s.peakCcu.capturedAt) : '—'}
        />
        <Kpi
          label="Home rank"
          value={s.homeRank ? `#${s.homeRank.peakRank}` : '—'}
          hint={
            s.homeRank ? `${s.homeRank.weeksTopDecile} wks top-10%` : 'no rank'
          }
        />
      </div>

      {/* ── Tabs ── */}
      <GameTabNav
        counts={{
          estimates: s.estimatesCount,
          milestones: s.milestonesCount,
        }}
      />

      <Suspense key={tab} fallback={<TabSkeleton />}>
        {tab === 'overview' && <OverviewTab s={s} />}
        {tab === 'estimates' && <EstimatesTab s={s} gameId={id} />}
        {tab === 'charts' && <ChartsTab gameId={id} has={has} />}
        {tab === 'matcher' && (
          <MatcherTab
            gameId={id}
            has={has}
            excluded={s.excludedFromReference}
          />
        )}
        {tab === 'milestones' && <MilestonesTab s={s} />}
      </Suspense>
    </div>
  );
}

// ─── KPI ────────────────────────────────────────────────────────────────────

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="bg-card p-3.5">
      <div className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tracking-tight tabular-nums">
        {value}
      </div>
      {hint && <div className="text-muted-foreground mt-0.5 text-[11px]">{hint}</div>}
    </div>
  );
}

// ─── Overview tab (from summary, no extra fetch) ─────────────────────────────

function OverviewTab({ s }: { s: AdminGamePageSummary }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1.3fr_.7fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold tracking-wide uppercase">
            Metadata
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-sm">
            <Meta label="Developer">{s.developer ?? '—'}</Meta>
            <Meta label="Publisher">
              {s.publisherRecord ? s.publisherRecord.name : (s.publisher ?? '—')}
            </Meta>
            <Meta label="Released">
              {fmtDate(s.releaseDate)}
              {s.isAnnualIteration && s.iterationNumber != null && (
                <span className="text-muted-foreground"> · iter {s.iterationNumber}</span>
              )}
            </Meta>
            {s.platformReleaseDates.length > 0 && (
              <Meta label="Per platform">
                <span className="tabular-nums">
                  {s.platformReleaseDates
                    .map((r) => `${r.platform} ${fmtDate(r.releaseDate)}`)
                    .join(' · ')}
                </span>
              </Meta>
            )}
            {s.franchiseSlug && <Meta label="Franchise">{s.franchiseSlug}</Meta>}
            <Meta label="Genres">
              <ChipSet items={s.genres} />
            </Meta>
            <Meta label="Steam tags">
              <ChipSet items={s.steamTags} />
            </Meta>
            <Meta label="DLC">{s.dlc.length}</Meta>
          </dl>
          {s.summary && (
            <p className="text-muted-foreground text-sm leading-relaxed">
              {s.summary}
            </p>
          )}
          <EditGameForm
            initial={{
              id: s.id,
              name: s.name,
              releaseDate: s.releaseDate,
              igdbId: s.igdbId,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold tracking-wide uppercase">
            Latest estimate
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {s.latestEstimate ? (
            <>
              <div>
                <div className="text-3xl font-bold tracking-tight tabular-nums">
                  {compactMid(
                    s.latestEstimate.estimatedTodayLow,
                    s.latestEstimate.estimatedTodayHigh,
                  )}
                </div>
                <div className="text-muted-foreground text-xs">
                  {fmtRange(
                    s.latestEstimate.estimatedTodayLow,
                    s.latestEstimate.estimatedTodayHigh,
                  )}{' '}
                  · computed {fmtDate(s.latestEstimate.computedAt)}
                </div>
              </div>
              <p className="text-muted-foreground text-xs">
                Full calculation trace in the <strong>Estimates</strong> tab.
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">
              No snapshot yet — hit <strong>Rebuild</strong> in the header to
              compute the headline estimate.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground self-center text-[11px] font-semibold tracking-wide uppercase">
        {label}
      </dt>
      <dd className="m-0">{children}</dd>
    </>
  );
}

function ChipSet({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((it) => (
        <span
          key={it}
          className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[11px]"
        >
          {it}
        </span>
      ))}
    </span>
  );
}

// ─── Estimates tab — corpus estimate, per-method pipeline ─────────────

const PLATFORM_ORDER: Platform[] = ['PC', 'PLAYSTATION', 'XBOX', 'SWITCH'];

async function EstimatesTab({
  s,
  gameId,
}: {
  s: AdminGamePageSummary;
  gameId: string;
}) {
  const b = await adminFetch<AdminEstimateBreakdown>(
    `/games/${gameId}/estimate-breakdown`,
  ).catch(() => null);

  const algo = b?.total ?? null; // corpus-derived estimate
  const latestEstimate = s.latestEstimate;
  const declared = b?.declared ?? null;

  const platforms =
    b?.platforms
      .slice()
      .sort(
        (a, c) =>
          PLATFORM_ORDER.indexOf(a.platform) -
          PLATFORM_ORDER.indexOf(c.platform),
      ) ?? [];

  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted-foreground text-xs">
        Inputs refreshed {fmtDate(s.lastRefreshedAt)}. Use{' '}
        <strong>Refresh</strong> / <strong>Rebuild</strong> in the header to
        re-run.
      </p>

      <Card>
        <CardContent className="pt-5">
          <div className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
            Estimate today
          </div>
          <div className="mt-1 text-2xl font-bold tracking-tight tabular-nums">
            {algo
              ? compactMid(algo.low, algo.high)
              : latestEstimate
                ? compactMid(
                    latestEstimate.estimatedTodayLow,
                    latestEstimate.estimatedTodayHigh,
                  )
                : '—'}
          </div>
          <div className="text-muted-foreground mt-0.5 text-[11px]">
            {algo
              ? `${fmtRange(algo.low, algo.high)} · corpus model`
              : 'no snapshot — hit Rebuild'}
          </div>
        </CardContent>
      </Card>

      {b && algo ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold tracking-wide uppercase">
              How the estimate {compactMid(algo.low, algo.high)} is built
            </CardTitle>
            <p className="text-muted-foreground text-xs">
              Each platform aggregates its methods; consoles are ventilated from
              PC/PS via the matcher split.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {platforms.map((p) => (
              <div
                key={p.platform}
                className="flex flex-wrap items-center gap-2"
              >
                <Badge variant="secondary" className="w-24 justify-center">
                  {p.platform}
                </Badge>
                {p.entries.map((e, i) => (
                  <EntryNode key={i} entry={e} />
                ))}
                <PipeOp>→ agg</PipeOp>
                <PipeNode
                  label={`${p.platform} total`}
                  value={compactMid(p.aggregateLow, p.aggregateHigh)}
                  sub={fmtRange(p.aggregateLow, p.aggregateHigh)}
                />
              </div>
            ))}
            <div className="border-border flex flex-wrap items-center gap-2 border-t pt-3">
              <PipeOp>Σ platforms</PipeOp>
              <PipeNode
                label="Algo total"
                value={compactMid(algo.low, algo.high)}
                sub={fmtRange(algo.low, algo.high)}
                final
              />
            </div>

            {declared && (
              <div className="text-muted-foreground border-border border-t pt-3 text-xs">
                Declared{' '}
                <span className="text-foreground">
                  {compact(declared.units)}
                </span>{' '}
                ({declared.source}
                {declared.reportedAt
                  ? `, ${fmtDate(declared.reportedAt)}`
                  : ''}){' · '}
                algo <span className="text-foreground">today</span>{' '}
                {compactMid(algo.low, algo.high)}
                {' — '}
                {algo.high < declared.units ? (
                  <span className="font-semibold text-red-600 dark:text-red-400">
                    below a past declared figure — possible under-estimate
                  </span>
                ) : declared.units >= algo.low ? (
                  <span className="font-semibold text-amber-600 dark:text-amber-400">
                    declared falls within today&apos;s range
                  </span>
                ) : (
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    consistent — grown since the declaration
                  </span>
                )}
                <span className="text-muted-foreground">
                  {' '}
                  (different dates — not a like-for-like ratio)
                </span>
              </div>
            )}

            <details className="group border-border border-t pt-3">
              <summary className="text-primary cursor-pointer list-none text-xs font-semibold">
                <span className="inline-block transition-transform group-open:rotate-90">
                  ›
                </span>{' '}
                Show full trace — every input, source &amp; weight
              </summary>
              <div className="mt-3">
                <EstimateBreakdownView breakdown={b} />
              </div>
            </details>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="text-muted-foreground p-6 text-sm">
            No estimate computed yet — hit <strong>Rebuild</strong> in the
            header.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** One estimation method as a pipeline node, formula in the subtitle. */
function EntryNode({
  entry,
}: {
  entry: AdminEstimateBreakdown['platforms'][number]['entries'][number];
}) {
  if (entry.type === 'boxleiter') {
    return (
      <PipeNode
        label="Boxleiter"
        value={compactMid(entry.finalLow, entry.finalHigh)}
        sub={`${compact(entry.signal.value)} ${entry.signal.metric} × ${entry.multiplierLow.toFixed(1)}–${entry.multiplierHigh.toFixed(1)} [${entry.multiplierSource}]`}
      />
    );
  }
  if (entry.type === 'first-week') {
    return (
      <PipeNode
        label="First-week CCU"
        value={compactMid(entry.finalLow, entry.finalHigh)}
        sub={`peak ${compact(entry.launchPeakValue)} ×[${entry.ccuRatioLow},${entry.ccuRatioHigh}] → wk1 → ×${entry.projectionMultiplier.toFixed(2)} [${entry.profileSource}]`}
      />
    );
  }
  return (
    <PipeNode
      label={`Split ← ${entry.sourcePlatform}`}
      value={compactMid(entry.finalLow, entry.finalHigh)}
      sub={`× ${entry.ratio.toFixed(2)} (share ${(entry.targetShare * 100).toFixed(0)}%/${(entry.sourceShare * 100).toFixed(0)}%)`}
    />
  );
}

function PipeNode({
  label,
  value,
  sub,
  final,
}: {
  label: string;
  value: string;
  sub?: string;
  final?: boolean;
}) {
  return (
    <div
      className={
        final
          ? 'bg-primary/10 border-primary min-w-[120px] rounded-lg border px-3 py-2'
          : 'bg-background border-border min-w-[120px] rounded-lg border px-3 py-2'
      }
    >
      <div className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tracking-tight tabular-nums">
        {value}
      </div>
      {sub && <div className="text-muted-foreground mt-0.5 text-[10px]">{sub}</div>}
    </div>
  );
}

function PipeOp({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-primary/10 text-primary self-center rounded-md px-2 py-1 font-mono text-[11px] whitespace-nowrap">
      {children}
    </span>
  );
}

// ─── Charts tab (fetches /charts) ────────────────────────────────────────────

async function ChartsTab({
  gameId,
  has,
}: {
  gameId: string;
  has: (p: Platform) => boolean;
}) {
  const c = await adminFetch<AdminGameChartsData>(`/games/${gameId}/charts`);
  const isSteam = has('PC') || c.reviewHistory.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-2">
        {isSteam && (
          <ChartCard title="Steam concurrent players">
            <CcuHistoryChart ccuHistory={c.ccuHistory} peak={null} peakAt={null} />
          </ChartCard>
        )}
        {isSteam && (
          <ChartCard title="Steam reviews">
            <ReviewHistoryChart reviewHistory={c.reviewHistory} />
          </ChartCard>
        )}
        <ChartCard title="Steam followers">
          <FollowersHistoryChart followersHistory={c.followersHistory} />
        </ChartCard>
        <ChartCard title="Twitch viewers">
          <TwitchViewersHistoryChart
            twitchViewersHistory={c.twitchViewersHistory}
          />
        </ChartCard>
        {has('PLAYSTATION') && c.psRatingsHistory.length > 0 && (
          <ChartCard title="PlayStation ratings">
            <ReviewHistoryChart
              reviewHistory={c.psRatingsHistory}
              syntheticHistory={c.psRatingsSyntheticHistory}
            />
          </ChartCard>
        )}
        {has('XBOX') && c.xboxRatingsHistory.length > 0 && (
          <ChartCard title="Xbox ratings">
            <ReviewHistoryChart reviewHistory={c.xboxRatingsHistory} />
          </ChartCard>
        )}
        {has('SWITCH') && c.switchRatingsHistory.length > 0 && (
          <ChartCard title="Switch ratings">
            <ReviewHistoryChart reviewHistory={c.switchRatingsHistory} />
          </ChartCard>
        )}
        {c.prices.length > 0 && (
          <ChartCard title="Steam price history">
            <div className="text-muted-foreground p-4 text-xs">
              {c.prices.length} price points · latest{' '}
              {(c.prices[c.prices.length - 1].final / 100).toFixed(2)}{' '}
              {c.prices[c.prices.length - 1].currency}
            </div>
          </ChartCard>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold tracking-wide uppercase">
            Signal snapshots · last {c.signals.length}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Captured</TableHead>
                  <TableHead>Metric</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.signals.slice(0, 60).map((sig) => (
                  <TableRow key={sig.id}>
                    <TableCell className="font-mono text-xs">
                      {fmtDate(sig.capturedAt)}
                    </TableCell>
                    <TableCell className="text-xs">{sig.metric}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {sig.value.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {sig.source}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold tracking-wide uppercase">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}

// ─── Matcher tab (fetches /matcher, explains the choice) ─────────────────────

async function MatcherTab({
  gameId,
  has,
  excluded,
}: {
  gameId: string;
  has: (p: Platform) => boolean;
  excluded: boolean;
}) {
  const m = await adminFetch<AdminMatcherInspection | null>(
    `/games/${gameId}/matcher`,
  ).catch(() => null);
  if (!m) {
    return (
      <Card>
        <CardContent className="text-muted-foreground p-6 text-sm">
          No matcher result (corpus empty or matcher disabled).
        </CardContent>
      </Card>
    );
  }
  const r = m.resolved;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={m.matcherEnabled ? 'default' : 'outline'}>
          Matcher {m.matcherEnabled ? 'on' : 'off'}
        </Badge>
        {m.isAnchor && <Badge variant="secondary">Is anchor</Badge>}
        <Badge variant={m.coldStart ? 'destructive' : 'outline'}>
          {m.coldStart ? 'Cold-start (baseline)' : 'Matched'}
        </Badge>
        <Badge variant="outline">{m.neighboursUsed} neighbours</Badge>
        {excluded && (
          <Badge variant="destructive">Excluded from reference corpus</Badge>
        )}
        <form
          action={setReferenceExclusion.bind(null, gameId, !excluded)}
          className="ml-auto"
        >
          <Button type="submit" variant="outline" size="sm">
            {excluded
              ? 'Include in reference corpus'
              : 'Exclude from reference corpus'}
          </Button>
        </form>
      </div>
      {excluded && (
        <p className="text-muted-foreground -mt-2 text-xs">
          This game is not used as an anchor for other games&apos; estimates
          (its data would skew the references). It still gets its own estimate.
        </p>
      )}

      {/* resolved profile stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Kpi
          label="Reviews→units"
          value={m.reviewsToUnits != null ? `×${m.reviewsToUnits.toFixed(1)}` : '—'}
        />
        <Kpi
          label="Global reviews→units"
          value={
            m.globalReviewsToUnits != null
              ? `×${m.globalReviewsToUnits.toFixed(1)}`
              : '—'
          }
        />
        <Kpi
          label="m1 (×Y1)"
          value={r ? `×${r.firstWeekToYearOneMultiplier.toFixed(2)}` : '—'}
        />
        <Kpi label="Y2 retention" value={r ? r.year2Retention : '—'} />
        <Kpi
          label="CCU→W1"
          value={m.peakCcuRatio != null ? `×${m.peakCcuRatio.toFixed(1)}` : '—'}
        />
      </div>

      {r && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold tracking-wide uppercase">
              Sales split
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {(() => {
              // The matcher's resolved shares are a generic neighbour-average
              // across ALL platforms. Renormalise over only the platforms this
              // game actually shipped on, so a PC-only game reads PC 100% (not
              // the raw 50%) — matching what the estimator actually ventilates.
              const raw = [
                has('PC') && { label: 'PC', v: r.pcShare },
                has('PLAYSTATION') && {
                  label: 'PlayStation',
                  v: r.playstationShare,
                },
                has('XBOX') && { label: 'Xbox', v: r.xboxShare },
                has('SWITCH') && { label: 'Switch', v: r.switchShare },
              ].filter((x): x is { label: string; v: number } => Boolean(x));
              const sum = raw.reduce((a, x) => a + x.v, 0) || 1;
              return raw.map((x) => (
                <SplitRow key={x.label} label={x.label} pct={x.v / sum} />
              ));
            })()}
          </CardContent>
        </Card>
      )}

      {/* how the neighbourhood was chosen */}
      {m.selection && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold tracking-wide uppercase">
              How this neighbourhood was chosen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <div className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wide uppercase">
                  Filters applied first
                </div>
                <div className="flex flex-col gap-2">
                  <FilterRow kind="hard">
                    Play-mode = <strong>{m.selection.playMode}</strong> — other
                    modes excluded
                  </FilterRow>
                  {m.selection.platformFiltered ? (
                    <FilterRow kind="hard">
                      Shares ≥1 platform with the target
                    </FilterRow>
                  ) : (
                    <FilterRow kind="soft">
                      Platform overlap relaxed (cold-start)
                    </FilterRow>
                  )}
                  <FilterRow kind="rank">
                    {m.selection.candidatesConsidered} candidates ranked by
                    weighted similarity, top <strong>k={m.selection.k}</strong>{' '}
                    kept
                  </FilterRow>
                </div>
              </div>
              <div>
                <div className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wide uppercase">
                  Similarity weights (how &ldquo;close&rdquo; is scored)
                </div>
                <div className="flex flex-col gap-1.5">
                  {Object.entries(m.selection.weights)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, w]) => (
                      <SplitRow key={k} label={k} pct={w} />
                    ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* nearest anchors with per-feature contribution bars */}
      {m.neighbours.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold tracking-wide uppercase">
              Nearest anchors · why each matched
            </CardTitle>
            <p className="text-muted-foreground text-xs">
              similarity² × quality = weight · bars show each feature&apos;s
              contribution to the score
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            {m.neighbours.map((n) => (
              <div
                key={n.gameId}
                className="border-border bg-background rounded-lg border p-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <Link
                    href={`/admin/games/${n.gameId}`}
                    className="text-primary text-sm font-medium hover:underline"
                  >
                    {n.gameName}
                  </Link>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    sim {n.similarity.toFixed(3)} · weight{' '}
                    {n.weight.toFixed(3)}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-5 gap-y-1.5 sm:grid-cols-3">
                  {n.featureContributions
                    .filter((f) => f.contribution > 0.001)
                    .slice(0, 6)
                    .map((f) => (
                      <FeatBar
                        key={f.feature}
                        label={f.feature}
                        score={f.score}
                        contribution={f.contribution}
                      />
                    ))}
                </div>
                {n.profile && (
                  <div className="text-muted-foreground border-border mt-2.5 flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-[11px] tabular-nums">
                    <span>
                      R→U{' '}
                      <span className="text-foreground">
                        {n.profile.reviewsToUnits != null
                          ? `×${n.profile.reviewsToUnits.toFixed(1)}`
                          : '—'}
                      </span>
                    </span>
                    <span>
                      G→U{' '}
                      <span className="text-foreground">
                        {n.profile.globalReviewsToUnits != null
                          ? `×${n.profile.globalReviewsToUnits.toFixed(1)}`
                          : '—'}
                      </span>
                    </span>
                    <span>
                      CCU→W1{' '}
                      <span className="text-foreground">
                        {n.profile.peakCcuRatio != null
                          ? `×${n.profile.peakCcuRatio.toFixed(1)}`
                          : '—'}
                      </span>
                    </span>
                    <span>
                      scale{' '}
                      <span className="text-foreground">
                        {compact(n.profile.scaleUnits)}
                      </span>
                    </span>
                    <span>
                      Y2{' '}
                      <span className="text-foreground">
                        {n.profile.curve.a2 != null
                          ? `×${n.profile.curve.a2.toFixed(2)}`
                          : '—'}
                      </span>
                    </span>
                    <span>
                      quality{' '}
                      <span className="text-foreground">
                        {n.profile.qualityScore.toFixed(2)}
                      </span>
                    </span>
                    {n.profile.platformShares && (
                      <span>
                        split{' '}
                        <span className="text-foreground">
                          {(n.profile.platformShares.pc * 100).toFixed(0)}/
                          {(n.profile.platformShares.ps * 100).toFixed(0)}/
                          {(n.profile.platformShares.xbox * 100).toFixed(0)}/
                          {(n.profile.platformShares.switch * 100).toFixed(0)}
                        </span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FilterRow({
  kind,
  children,
}: {
  kind: 'hard' | 'soft' | 'rank';
  children: React.ReactNode;
}) {
  const tone =
    kind === 'hard'
      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
      : kind === 'rank'
        ? 'bg-primary/15 text-primary'
        : 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
  return (
    <div className="border-border bg-background flex items-center gap-2.5 rounded-md border px-3 py-2 text-xs">
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${tone}`}
      >
        {kind}
      </span>
      <span className="text-muted-foreground">{children}</span>
    </div>
  );
}

function SplitRow({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="grid grid-cols-[110px_1fr_44px] items-center gap-3 text-xs">
      <span>{label}</span>
      <span className="bg-muted h-2 overflow-hidden rounded-full">
        <span
          className="bg-primary block h-full rounded-full"
          style={{ width: `${Math.min(100, Math.max(0, pct * 100))}%` }}
        />
      </span>
      <span className="text-right tabular-nums">{(pct * 100).toFixed(0)}%</span>
    </div>
  );
}

function FeatBar({
  label,
  score,
  contribution,
}: {
  label: string;
  score: number;
  contribution: number;
}) {
  return (
    <div className="relative pb-2.5">
      <div className="text-muted-foreground flex items-baseline justify-between gap-2 text-[11px]">
        <span>{label}</span>
        <span className="text-foreground tabular-nums">
          {score.toFixed(2)}
        </span>
      </div>
      <span
        className="bg-primary/55 absolute bottom-0 left-0 h-[3px] rounded-full"
        style={{ width: `${Math.min(100, Math.max(2, contribution * 100 * 2.5))}%` }}
      />
    </div>
  );
}

// ─── Milestones tab ──────────────────────────────────────────────────────────

function MilestonesTab({ s }: { s: AdminGamePageSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold tracking-wide uppercase">
          Declared milestones · {s.milestonesCount}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {/* Same MilestoneRow component as the /admin/milestones listing — it's a
            table row, so it must live inside a <Table>. `gameName` is omitted
            here (we're already on the game), giving the 8-column layout. */}
        <div className="overflow-x-auto">
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
              {s.milestones.map((m) => (
                <MilestoneRow key={m.id} milestone={m} />
              ))}
              {s.milestones.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-muted-foreground py-12 text-center"
                  >
                    No milestones yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function TabSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="bg-muted h-8 w-48 animate-pulse rounded" />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="bg-muted h-48 animate-pulse rounded-xl" />
        <div className="bg-muted h-48 animate-pulse rounded-xl" />
      </div>
    </div>
  );
}

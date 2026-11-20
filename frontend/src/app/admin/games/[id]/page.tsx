import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  adminFetch,
  type AdminGamePageSummary,
  type AdminGameChartsData,
  type AdminMatcherInspection,
  type AdminV2Estimate,
  type AdminIgdbFacts,
  type AdminV2Explanation,
} from '@/lib/admin';
import type { GameMode, GameType, Platform } from '@/lib/api';
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
import { GenerateBlogDraftButton } from '../../_components/GenerateBlogDraftButton';
import { EditGameForm } from '../../_components/EditGameForm';
import { MilestoneRow } from '../../_components/MilestoneRow';
import { AddMilestoneForm } from '../../_components/AddMilestoneForm';
import { CcuHistoryChart } from '../../_components/CcuHistoryChart';
import { ReviewHistoryChart } from '../../_components/ReviewHistoryChart';
import { FollowersHistoryChart } from '../../_components/FollowersHistoryChart';
import { TwitchViewersHistoryChart } from '../../_components/TwitchViewersHistoryChart';
import {
  deleteGame,
  setEstimateBeforeFloor,
  setEstimateHidden,
  setReferenceExclusion,
} from '../../actions';

export const dynamic = 'force-dynamic';

// ─── helpers ────────────────────────────────────────────────────────────────

function compact(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return `${n}`;
}

// How the V2 model reached its estimate, and why it gives none.
const V2_BASIS: Record<string, string> = {
  anchored: 'anchored on the last published total',
  'platform-floor': 'floor: a published platform figure',
  model: 'model',
  'model-raised-by-consoles': 'model, raised by the console ratings',
  consoles: 'console ratings alone',
  'not-estimated': 'not estimated',
};
const V2_STATUS: Record<string, string> = {
  excluded: 'excluded by hand in the frozen model',
  'out-of-scope': 'out of scope (free, deleted or released before 2017)',
  unreleased: 'not released yet',
};

// The headline number for an estimate is always the midpoint of its [low, high]
// band — a single number == the range's high would systematically overstate.
function midpoint(low: number, high: number): number {
  return (low + high) / 2;
}
function compactMid(low: number, high: number): string {
  return compact(midpoint(low, high));
}
// A snapshot carries the figure the site displayed: the ML estimate itself
// (its range is estimate ÷/× a factor, so its midpoint would overstate it) or
// the platform-sum midpoint. Older rows only have the range.
function compactSnapshot(s: {
  estimatedTodayLow: number;
  estimatedTodayHigh: number;
  estimatedTodayUnits: number | null;
}): string {
  return s.estimatedTodayUnits != null
    ? compact(s.estimatedTodayUnits)
    : compactMid(s.estimatedTodayLow, s.estimatedTodayHigh);
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

function fmtHoursFromMinutes(minutes: number | null): string {
  if (minutes == null) return '—';
  return `${(minutes / 60).toFixed(1)}h`;
}

// ─── page ─────────────────────────────────────────────────────────────────

export default async function AdminGameDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; platform?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam, platform: platformParam } = await searchParams;
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
                <Badge
                  className={
                    s.catalogTier === 'CORE'
                      ? 'border-transparent bg-white/90 text-[10px] text-neutral-900'
                      : 'border-white/30 bg-white/15 text-[10px] text-white'
                  }
                >
                  {s.catalogTier === 'CORE' ? 'Core' : 'Extended'}
                </Badge>
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
            {!s.isFree && <RebuildEstimatesButton gameId={s.id} />}
            {!s.isFree && <GenerateBlogDraftButton gameId={s.id} />}
            <DeleteButton
              action={deleteGame.bind(null, s.id)}
              confirmMessage={`Permanently delete "${s.name}"?`}
              label="Delete"
            />
          </div>
        </div>
      </div>

      {s.isFree && (
        <p className="border-border bg-muted/40 rounded-xl border px-4 py-3 text-sm">
          This game is free-to-play, so it has no sales estimate.
        </p>
      )}

      {/* ── KPI strip ── */}
      <div className="border-border grid grid-cols-2 divide-x divide-y overflow-hidden rounded-xl border sm:grid-cols-6 sm:divide-y-0">
        <Kpi
          label="Est. today"
          value={
            s.isFree
              ? 'n/a'
              : estToday
                ? compactSnapshot(estToday)
                : '—'
          }
          hint={
            s.isFree
              ? 'free-to-play'
              : estToday
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
          label="Median playtime"
          value={fmtHoursFromMinutes(
            latest(s, 'STEAM_REVIEWER_MEDIAN_PLAYTIME'),
          )}
          hint="Steam reviewers"
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
        showEstimates={!s.isFree}
        counts={{
          estimates: s.estimatesCount,
          milestones: s.milestonesCount,
        }}
      />

      <Suspense key={tab} fallback={<TabSkeleton />}>
        {tab === 'overview' && <OverviewTab s={s} />}
        {tab === 'estimates' &&
          (s.isFree ? <FreeToPlayEstimateNotice /> : <EstimatesTab s={s} gameId={id} />)}
        {tab === 'charts' && <ChartsTab gameId={id} has={has} isFree={s.isFree} />}
        {tab === 'matcher' && (
          <MatcherTab
            gameId={id}
            has={has}
            excluded={s.excludedFromReference}
          />
        )}
        {tab === 'milestones' && (
          <MilestonesTab s={s} platform={platformParam ?? null} />
        )}
      </Suspense>
    </div>
  );
}

// ─── KPI ────────────────────────────────────────────────────────────────────

function FreeToPlayEstimateNotice() {
  return (
    <p className="border-border bg-muted/40 rounded-xl border px-4 py-3 text-sm">
      This game is free-to-play, so it has no sales estimate.
    </p>
  );
}

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
            <Meta label="Catalog">
              {s.catalogTier === 'CORE' ? 'Core' : 'Extended'}
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
          <IgdbFactsList igdb={s.igdb} />
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
              summary: s.summary,
              coverUrl: s.coverUrl,
              developer: s.developer,
              publisher: s.publisher,
              platforms: s.platforms,
              genres: s.genres,
              categories: s.categories,
              steamTags: s.steamTags,
              isFree: s.isFree,
              liveService: s.liveService,
              manualFields: s.manualFields ?? [],
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
          {s.isFree ? (
            <p className="text-muted-foreground">
              This game is free-to-play, so it has no sales estimate.
            </p>
          ) : s.latestEstimate ? (
            <>
              <div>
                <div className="text-3xl font-bold tracking-tight tabular-nums">
                  {compactSnapshot(s.latestEstimate)}
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

const ADMIN_GAME_TYPE_LABELS: Record<GameType, string> = {
  MAIN_GAME: 'Main game',
  DLC: 'DLC',
  EXPANSION: 'Expansion',
  BUNDLE: 'Bundle',
  STANDALONE_EXPANSION: 'Standalone expansion',
  MOD: 'Mod',
  EPISODE: 'Episode',
  SEASON: 'Season',
  REMAKE: 'Remake',
  REMASTER: 'Remaster',
  EXPANDED_GAME: 'Expanded game',
  PORT: 'Port',
  FORK: 'Fork',
  PACK: 'Pack / add-on',
  UPDATE: 'Update',
};

const ADMIN_GAME_MODE_LABELS: Record<GameMode, string> = {
  SINGLE_PLAYER: 'Single player',
  MULTIPLAYER: 'Multiplayer',
  CO_OP: 'Co-op',
  SPLIT_SCREEN: 'Split screen',
  MMO: 'MMO',
  BATTLE_ROYALE: 'Battle royale',
};

function fmtHours(seconds: number | null): string {
  if (!seconds) return '—';
  const hours = seconds / 3600;
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
}

/** What the nightly IGDB refresh stored (`IgdbRefreshService`). */
function IgdbFactsList({ igdb }: { igdb: AdminIgdbFacts }) {
  const ttb = igdb.timeToBeat;
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <div className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
        IGDB · refreshed {fmtDate(igdb.checkedAt)}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-sm">
        <Meta label="Type">
          {igdb.gameType ? ADMIN_GAME_TYPE_LABELS[igdb.gameType] : '—'}
          {igdb.parentGame && (
            <span className="text-muted-foreground">
              {' of '}
              {igdb.parentGame.gameId ? (
                <Link
                  href={`/admin/games/${igdb.parentGame.gameId}`}
                  className="text-primary hover:underline"
                >
                  {igdb.parentGame.name}
                </Link>
              ) : (
                <>
                  {igdb.parentGame.name} (IGDB {igdb.parentGame.igdbId}, not in
                  catalog)
                </>
              )}
            </span>
          )}
        </Meta>
        <Meta label="Modes">
          <ChipSet items={igdb.gameModes.map((m) => ADMIN_GAME_MODE_LABELS[m])} />
        </Meta>
        <Meta label="Time to beat">
          {ttb ? (
            <span className="tabular-nums">
              {fmtHours(ttb.hastily)} rushed · {fmtHours(ttb.normally)} normal ·{' '}
              {fmtHours(ttb.completely)} complete{' '}
              <span className="text-muted-foreground">
                ({ttb.count} reports)
              </span>
            </span>
          ) : (
            '—'
          )}
        </Meta>
        <Meta label="Store ids">
          <span className="font-mono text-xs">
            PS {igdb.psConceptIds.join(', ') || '—'} · Xbox{' '}
            {igdb.xboxProductIds.join(', ') || '—'}
          </span>
        </Meta>
        <Meta label="Other stores">
          <span className="flex flex-wrap gap-3">
            {igdb.epicUrl && (
              <a
                href={igdb.epicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Epic
              </a>
            )}
            {igdb.gogUrl && (
              <a
                href={igdb.gogUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                GOG
              </a>
            )}
            {igdb.gamePassCloud && (
              <Badge variant="secondary">Game Pass cloud</Badge>
            )}
            {!igdb.epicUrl && !igdb.gogUrl && !igdb.gamePassCloud && '—'}
          </span>
        </Meta>
      </dl>
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

// ─── Estimates tab — worldwide V2 estimate, platform split ───────────────

const PLATFORM_ORDER: Platform[] = ['PC', 'PLAYSTATION', 'XBOX', 'SWITCH'];

async function EstimatesTab({
  s,
  gameId,
}: {
  s: AdminGamePageSummary;
  gameId: string;
}) {
  // The V2 computed live (no platform pipeline: fast): what the site shows
  // from the game's next rebuild.
  const v2 = await adminFetch<AdminV2Estimate | null>(
    `/games/${gameId}/v2-estimate`,
  ).catch(() => null);
  const live = v2?.units != null && v2.low != null && v2.high != null ? v2 : null;
  // What the site shows now: the last stored snapshot.
  const published = s.latestEstimate;
  const publishedUnits = published
    ? (published.estimatedTodayUnits ??
      midpoint(published.estimatedTodayLow, published.estimatedTodayHigh))
    : null;
  // A rebuild would change the public figure (1 % tolerance for rounding).
  const stale =
    v2 !== null &&
    (live
      ? publishedUnits === null ||
        Math.abs(publishedUnits - live.units!) > live.units! * 0.01
      : publishedUnits !== null);

  // The public site estimates games released from 2017 on; an older one can
  // be let through by hand (see `games/estimate-scope.ts`).
  const beforeFloor =
    s.releaseDate !== null &&
    new Date(s.releaseDate) < new Date('2017-01-01T00:00:00.000Z');


  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        {s.estimateHidden && (
          <Badge variant="destructive">Estimate hidden on the public site</Badge>
        )}
        <form
          action={setEstimateHidden.bind(null, gameId, !s.estimateHidden)}
          className="ml-auto"
        >
          <Button type="submit" variant="outline" size="sm">
            {s.estimateHidden
              ? 'Show estimate on the site'
              : 'Hide estimate on the site'}
          </Button>
        </form>
      </div>
      {(beforeFloor || s.estimateBeforeFloor) && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={s.estimateBeforeFloor ? 'default' : 'secondary'}>
            {s.estimateBeforeFloor
              ? 'Released before 2017: estimate allowed on the site'
              : 'Released before 2017: not estimated on the site'}
          </Badge>
          <form
            action={setEstimateBeforeFloor.bind(
              null,
              gameId,
              !s.estimateBeforeFloor,
            )}
            className="ml-auto"
          >
            <Button type="submit" variant="outline" size="sm">
              {s.estimateBeforeFloor
                ? 'Back under the 2017 floor'
                : 'Allow estimate despite 2017 floor'}
            </Button>
          </form>
        </div>
      )}
      {s.estimateBeforeFloor && (
        <p className="text-muted-foreground -mt-3 text-xs">
          The site shows this game&apos;s estimate although the model is less
          reliable before 2017. &ldquo;Hide estimate on the site&rdquo; still
          wins over this switch.
        </p>
      )}
      {s.estimateHidden && (
        <p className="text-muted-foreground -mt-3 text-xs">
          The site shows no figure and no chart for this game: its public
          signals do not measure it alone (shared launcher or store page). The
          estimate is still computed here.
        </p>
      )}

      {/* ── Live V2 vs what the site shows now ── */}
      <Card>
        <CardContent className="grid gap-4 pt-5 sm:grid-cols-2">
          <div>
            <div className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
              V2 estimate · live
            </div>
            <div className="mt-1 text-2xl font-bold tracking-tight tabular-nums">
              {live ? compact(live.units) : v2 ? 'Not estimated' : '—'}
            </div>
            <div className="text-muted-foreground mt-0.5 text-[11px]">
              {live
                ? `${fmtRange(live.low!, live.high!)} · ${V2_BASIS[live.basis ?? ''] ?? live.basis}`
                : v2
                  ? v2NotEstimatedReason(v2)
                  : 'V2 unavailable for this game'}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
              On the site now
            </div>
            <div className="mt-1 text-2xl font-bold tracking-tight tabular-nums">
              {published ? compactSnapshot(published) : '—'}
            </div>
            <div className="text-muted-foreground mt-0.5 text-[11px]">
              {published
                ? `${fmtRange(published.estimatedTodayLow, published.estimatedTodayHigh)} · computed ${fmtDate(published.computedAt)}`
                : 'no snapshot'}
            </div>
            {stale && (
              <div className="mt-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                Differs from the live V2: <strong>Rebuild</strong> in the header
                publishes it.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {v2 && <V2HowCard v2={v2} />}


      <p className="text-muted-foreground text-xs">
        Inputs refreshed {fmtDate(s.lastRefreshedAt)} · V2 {v2?.version ?? '—'}
        {' '}· computed {fmtDate(v2?.computedAt ?? null)}.
      </p>
    </div>
  );
}

function v2NotEstimatedReason(v2: AdminV2Estimate): string {
  return v2.status === 'estimated'
    ? 'no signal: under 10 Steam reviews, no console rating, no published figure'
    : (V2_STATUS[v2.status] ?? v2.status);
}

/** How the V2 rules reached the figure, one chain per basis. */
function V2HowCard({ v2 }: { v2: AdminV2Estimate }) {
  const model = (
    <PipeNode
      label="Model total"
      value={compact(v2.modelUnits)}
      sub={
        v2.modelLow != null && v2.modelHigh != null
          ? fmtRange(v2.modelLow, v2.modelHigh)
          : undefined
      }
    />
  );
  const result =
    v2.units != null ? (
      <PipeNode
        label="Estimate"
        value={compact(v2.units)}
        sub={
          v2.low != null && v2.high != null
            ? fmtRange(v2.low, v2.high)
            : undefined
        }
        final
      />
    ) : null;

  let chain: React.ReactNode = null;
  switch (v2.basis) {
    case 'anchored': {
      // The applied growth (launch-corrected, never below 1), not the raw
      // review ratio, which overstates it right after a launch.
      const applied =
        v2.units != null && v2.anchorUnits
          ? v2.units / v2.anchorUnits
          : null;
      const byReviews =
        v2.anchorSteamReviews != null &&
        v2.anchorSteamReviews > 0 &&
        v2.steamReviews != null &&
        v2.steamReviews >= v2.anchorSteamReviews;
      chain = (
        <>
          <PipeNode
            label="Last published total"
            value={compact(v2.anchorUnits)}
            sub={`${fmtDate(v2.anchorDate)} · ${compact(v2.anchorSteamReviews)} reviews`}
          />
          <PipeOp>
            {applied != null ? `×${applied.toFixed(2)} ` : '× '}
            {byReviews
              ? `(reviews ${compact(v2.anchorSteamReviews)} → ${compact(v2.steamReviews)}, launch-corrected)`
              : '(growth of the model)'}
          </PipeOp>
          {result}
        </>
      );
      break;
    }
    case 'model':
    case 'model-raised-by-consoles':
      chain = (
        <>
          {model}
          <PipeOp>max(model, consoles + PC)</PipeOp>
          <PipeNode
            label="Consoles + PC"
            value={compact((v2.consoleUnits ?? 0) + (v2.modelPc ?? 0))}
            sub={`${compact(v2.consoleUnits)} consoles · ${compact(v2.modelPc)} PC`}
          />
          <PipeOp>→</PipeOp>
          {result}
        </>
      );
      break;
    case 'consoles':
      chain = (
        <>
          <PipeNode
            label="Console ratings"
            value={compact(v2.consoleUnits)}
            sub="under 10 Steam reviews"
          />
          <PipeOp>→</PipeOp>
          {result}
        </>
      );
      break;
    case 'platform-floor':
      chain = (
        <>
          {model}
          <PipeOp>below a published figure</PipeOp>
          <PipeNode
            label="Best published"
            value={compact(v2.bestPublished)}
            sub="platform figure = floor"
          />
          <PipeOp>→</PipeOp>
          {result}
        </>
      );
      break;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold tracking-wide uppercase">
          How the V2 reaches it
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Anchored on the last published total when there is one; otherwise the
          model, raised to consoles + PC when the store ratings say more; a
          published platform figure is a floor.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {chain && <div className="flex flex-wrap items-center gap-2">{chain}</div>}
        <dl className="border-border grid grid-cols-2 gap-x-5 gap-y-1.5 border-t pt-3 text-xs sm:grid-cols-4">
          <Fact label="Model alone">
            {compact(v2.modelUnits)} · {compact(v2.modelPc)} PC
          </Fact>
          <Fact label="Consoles (ratings)">{compact(v2.consoleUnits)}</Fact>
          <Fact label="Steam reviews">{compact(v2.steamReviews)}</Fact>
          <Fact label="Best published">{compact(v2.bestPublished)}</Fact>
        </dl>
        {v2.explanation && (
          <V2ModelExplanation
            x={v2.explanation}
            modelUnits={v2.modelUnits}
            v2={v2}
          />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Why the model answered its total: from a game it knows nothing of, the
 * factor each family of inputs applies (exact Shapley values, they multiply
 * to the answer), with the values it read.
 */
/** How the model's figure relates to the estimate, per V2 rule. */
function modelRole(v2: AdminV2Estimate): string | null {
  switch (v2.basis) {
    case 'anchored':
      return 'For reference only: the estimate is anchored on the last published total, not on this figure (it only serves when the reviews cannot be followed).';
    case 'model-raised-by-consoles':
      return `The estimate starts from this figure, then the console ratings raise it to ${compact(v2.units)}.`;
    case 'platform-floor':
      return `For reference only: a published figure is higher (${compact(v2.bestPublished)}), it sets the floor.`;
    case 'consoles':
      return 'For reference only: under 10 Steam reviews, the estimate comes from the console ratings alone.';
    case 'model':
      return 'This figure is the estimate.';
    default:
      return null;
  }
}

function V2ModelExplanation({
  x,
  modelUnits,
  v2,
}: {
  x: AdminV2Explanation;
  modelUnits: number | null;
  v2: AdminV2Estimate;
}) {
  const role = modelRole(v2);
  const perReview = x.head === 'perReview';
  const fmt = (n: number) => (perReview ? n.toFixed(1) : compact(n));
  const rows = x.families.filter(
    (f) => Math.abs(Math.log(f.factor)) >= 0.005 || f.inputs.length > 0,
  );
  const maxLog = Math.max(...rows.map((f) => Math.abs(Math.log(f.factor))), 0.01);
  return (
    <div className="border-border flex flex-col gap-2.5 border-t pt-3">
      <div className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
        Why the model alone says {compact(modelUnits)}
      </div>
      {role && <p className="text-muted-foreground text-xs italic">{role}</p>}
      <p className="text-xs">
        {perReview ? (
          <>
            The model counts sales per Steam review, then multiplies by the
            reviews: <strong>{fmt(x.full)}</strong> ×{' '}
            <strong>{compact(x.steamReviews)}</strong> reviews ={' '}
            <strong>{compact(modelUnits)}</strong>.
          </>
        ) : (
          <>
            No Steam reviews, so the model counts sales directly:{' '}
            <strong>{compact(modelUnits)}</strong>.
          </>
        )}
      </p>
      <p className="text-xs">
        A game the model knows nothing about:{' '}
        <strong>
          {fmt(x.base)}
          {perReview ? ' sales per review' : ' sales'}
        </strong>
        . Each line below is one kind of information about this game and how
        much it moves that figure (green raises it, red lowers it):
      </p>
      <div className="flex flex-col gap-1.5">
        {rows.map((f) => {
          const l = Math.log(f.factor);
          const width = (Math.abs(l) / maxLog) * 50;
          const up = l >= 0;
          return (
            <div
              key={f.name}
              className="grid grid-cols-[110px_120px_48px_1fr] items-center gap-3 text-xs"
            >
              <span className="font-medium">{f.name}</span>
              <span className="bg-muted relative h-2 overflow-hidden rounded-full">
                <span className="bg-border absolute inset-y-0 left-1/2 w-px" />
                <span
                  className={
                    up
                      ? 'absolute inset-y-0 left-1/2 rounded-r-full bg-emerald-500'
                      : 'absolute inset-y-0 right-1/2 rounded-l-full bg-red-500'
                  }
                  style={{ width: `${width}%` }}
                />
              </span>
              <span
                className={
                  'text-right font-semibold tabular-nums ' +
                  (Math.abs(l) < 0.005
                    ? 'text-muted-foreground'
                    : up
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400')
                }
              >
                ×{f.factor.toFixed(2)}
              </span>
              <span className="text-muted-foreground truncate" title={f.inputs.map((i) => `${i.label}: ${i.value}`).join(' · ')}>
                {f.inputs.length
                  ? f.inputs.map((i) => `${i.label} ${i.value}`).join(' · ')
                  : 'nothing known'}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-muted-foreground text-[11px]">
        {fmt(x.base)}
        {rows.map((f) => ` × ${f.factor.toFixed(2)}`).join('')} ≈ {fmt(x.full)}
        {perReview ? ' sales per review' : ' sales'}. When two kinds of
        information act together, their joint effect is split fairly between
        them (Shapley values), so the factors always multiply to the
        model&apos;s figure.
      </p>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
        {label}
      </dt>
      <dd className="m-0 tabular-nums">{children}</dd>
    </div>
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
  isFree,
}: {
  gameId: string;
  has: (p: Platform) => boolean;
  isFree: boolean;
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
            <ReviewHistoryChart
              reviewHistory={c.xboxRatingsHistory}
              syntheticHistory={c.xboxRatingsSyntheticHistory}
            />
          </ChartCard>
        )}
        {has('SWITCH') && c.switchRatingsHistory.length > 0 && (
          <ChartCard title="Switch ratings">
            <ReviewHistoryChart reviewHistory={c.switchRatingsHistory} />
          </ChartCard>
        )}
        {!isFree && c.prices.length > 0 && (
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

// Worldwide first, then the storefronts in the usual order; anything else
// (rare platform labels) follows alphabetically.
const MILESTONE_PLATFORM_ORDER = ['GLOBAL', ...PLATFORM_ORDER];

function milestonePlatformRank(p: string): number {
  const i = MILESTONE_PLATFORM_ORDER.indexOf(p);
  return i === -1 ? MILESTONE_PLATFORM_ORDER.length : i;
}

function MilestonesTab({
  s,
  platform,
}: {
  s: AdminGamePageSummary;
  platform: string | null;
}) {
  const counts = new Map<string, number>();
  for (const m of s.milestones)
    counts.set(m.platform, (counts.get(m.platform) ?? 0) + 1);
  const platforms = [...counts.keys()].sort(
    (a, b) =>
      milestonePlatformRank(a) - milestonePlatformRank(b) || a.localeCompare(b),
  );
  // An unknown ?platform= (stale link) falls back to "All".
  const active = platform && counts.has(platform) ? platform : null;
  const rows = active
    ? s.milestones.filter((m) => m.platform === active)
    : s.milestones;
  const hrefFor = (p: string | null) =>
    `/admin/games/${s.id}?tab=milestones${p ? `&platform=${encodeURIComponent(p)}` : ''}`;
  const chips: { key: string | null; label: string; count: number }[] = [
    { key: null, label: 'All', count: s.milestones.length },
    ...platforms.map((p) => ({
      key: p,
      label: p === 'GLOBAL' ? 'Worldwide' : p,
      count: counts.get(p) ?? 0,
    })),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold tracking-wide uppercase">
          Declared milestones · {s.milestonesCount}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-0">
        <div className="px-6">
          <AddMilestoneForm gameId={s.id} />
        </div>
        {platforms.length > 1 && (
          <nav
            aria-label="Filter by platform"
            className="flex flex-wrap gap-1.5 px-6"
          >
            {chips.map((c) => {
              const on = c.key === active;
              return (
                <Link
                  key={c.key ?? 'all'}
                  href={hrefFor(c.key)}
                  scroll={false}
                  aria-current={on ? 'page' : undefined}
                  className={
                    on
                      ? 'border-primary bg-primary/10 text-foreground flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold'
                      : 'border-border text-muted-foreground hover:text-foreground flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs'
                  }
                >
                  {c.label}
                  <span className="tabular-nums opacity-70">{c.count}</span>
                </Link>
              );
            })}
          </nav>
        )}
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
                <TableHead>Reported</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => (
                <MilestoneRow key={m.id} milestone={m} />
              ))}
              {rows.length === 0 && (
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

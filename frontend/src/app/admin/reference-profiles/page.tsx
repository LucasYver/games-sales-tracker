import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  adminFetch,
  type AdminCorpusStats,
  type AdminReferenceProfile,
  type ReferencePlatformClass,
} from '@/lib/admin';

export const dynamic = 'force-dynamic';

const PLATFORM_CLASS_LABEL: Record<ReferencePlatformClass, string> = {
  PC_ONLY: 'PC only',
  CONSOLE_ONLY: 'Console only',
  PC_PLUS_CONSOLE: 'PC + console',
  UNKNOWN: 'Unknown',
};

function formatUnitsCompact(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toFixed(0);
}

export default async function AdminReferenceProfilesPage() {
  const [stats, anchors] = await Promise.all([
    adminFetch<AdminCorpusStats>('/reference-profiles/stats'),
    adminFetch<AdminReferenceProfile[]>('/reference-profiles'),
  ]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8">
      <header className="flex items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold tracking-tight">
            Reference profiles
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            The data-driven corpus (Forme C): one observed behavioural vector
            per anchor game — normalised review curve, reviews→units ratio,
            proxy platform split, scale and a composite quality score. The
            matcher aggregates the nearest anchors of a target game to resolve
            its estimation profile, replacing the hand-tuned genre profiles
            when active.
          </p>
        </div>
        <Badge
          variant={stats.matcherEnabled ? 'default' : 'outline'}
          className="shrink-0"
        >
          Matcher {stats.matcherEnabled ? 'on' : 'off'}
        </Badge>
      </header>

      <Tabs defaultValue="corpus">
        <TabsList>
          <TabsTrigger value="corpus">Corpus health</TabsTrigger>
          <TabsTrigger value="anchors">
            Anchors
            <Badge variant="secondary" className="ml-1.5">
              {stats.total}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="corpus" className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Anchors" value={stats.total.toString()} />
            <StatCard
              label="With review curve"
              value={`${stats.coverage.curve} / ${stats.total}`}
              hint="Anchors carrying a normalised year-1 curve (drives m1 / tail)."
            />
            <StatCard
              label="With reviews→units"
              value={`${stats.coverage.reviewsToUnits} / ${stats.total}`}
              hint="Anchors with a PC reviews→units ratio (drives the Boxleiter default)."
            />
            <StatCard
              label="With platform split"
              value={`${stats.coverage.platformShares} / ${stats.total}`}
              hint="Anchors with a proxied PC/console share (drives console ventilation)."
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-xs font-semibold tracking-wide uppercase">
                  Quality score
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between tabular-nums">
                  <span className="text-muted-foreground">Mean</span>
                  <span>{stats.quality.mean.toFixed(2)}</span>
                </div>
                <div className="flex justify-between tabular-nums">
                  <span className="text-muted-foreground">Median</span>
                  <span>{stats.quality.median.toFixed(2)}</span>
                </div>
                <div className="flex justify-between tabular-nums">
                  <span className="text-muted-foreground">Range</span>
                  <span>
                    {stats.quality.min.toFixed(2)} –{' '}
                    {stats.quality.max.toFixed(2)}
                  </span>
                </div>
                <div className="mt-2 flex flex-col gap-1">
                  {stats.qualityBuckets.map((b) => (
                    <BucketBar
                      key={b.label}
                      label={b.label}
                      count={b.count}
                      total={stats.total}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-xs font-semibold tracking-wide uppercase">
                  Platform mix
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">
                {(
                  Object.keys(stats.platformClass) as ReferencePlatformClass[]
                ).map((k) => (
                  <BucketBar
                    key={k}
                    label={PLATFORM_CLASS_LABEL[k]}
                    count={stats.platformClass[k]}
                    total={stats.total}
                  />
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-xs font-semibold tracking-wide uppercase">
                  Scale distribution
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">
                {stats.scaleBuckets.map((b) => (
                  <BucketBar
                    key={b.label}
                    label={b.label}
                    count={b.count}
                    total={stats.total}
                  />
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="anchors">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Game</TableHead>
                  <TableHead>Platforms</TableHead>
                  <TableHead className="text-right" title="Anchor scale (units)">
                    Scale
                  </TableHead>
                  <TableHead
                    className="text-right"
                    title="Reviews→units ratio (PC Boxleiter-equivalent)"
                  >
                    R→U
                  </TableHead>
                  <TableHead
                    className="text-right"
                    title="Week-1 cumulative reviews / year-1 (curve s1). m1 ≈ 1/s1"
                  >
                    s1
                  </TableHead>
                  <TableHead
                    className="text-right"
                    title="Year-2 / year-1 cumulative reviews (curve a2 = retention)"
                  >
                    a2
                  </TableHead>
                  <TableHead
                    className="text-right"
                    title="Observed launch peak CCU → week-1 units ratio"
                  >
                    CCU→W1
                  </TableHead>
                  <TableHead
                    className="text-right"
                    title="PC / PS / Xbox / Switch proxy split"
                  >
                    Split
                  </TableHead>
                  <TableHead
                    className="text-right"
                    title="Composite quality weight in [0,1]"
                  >
                    Q
                  </TableHead>
                  <TableHead className="text-right">Observed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {anchors.map((a) => (
                  <TableRow key={a.gameId} className="hover:bg-muted/40">
                    <TableCell className="font-medium">
                      <Link
                        href={`/admin/games/${a.gameId}`}
                        className="hover:underline"
                      >
                        {a.gameName}
                      </Link>
                      <div className="text-muted-foreground font-mono text-[10px]">
                        {a.gameSlug}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {PLATFORM_CLASS_LABEL[a.platformClass]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatUnitsCompact(a.scaleUnits)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {a.reviewsToUnits !== null
                        ? a.reviewsToUnits.toFixed(1)
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {a.curve.s1 !== null ? a.curve.s1.toFixed(2) : '—'}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {a.curve.a2 !== null ? a.curve.a2.toFixed(2) : '—'}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {a.peakCcuRatio !== null
                        ? `×${a.peakCcuRatio.toFixed(1)}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right font-mono text-[10px] tabular-nums">
                      {a.platformShares
                        ? [
                            a.platformShares.pc,
                            a.platformShares.ps,
                            a.platformShares.xbox,
                            a.platformShares.switch,
                          ]
                            .map((s) => Math.round(s * 100))
                            .join('/')
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {a.qualityScore.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right text-xs">
                      {new Date(a.observedAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </TableCell>
                  </TableRow>
                ))}
                {anchors.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="text-muted-foreground py-12 text-center"
                    >
                      No anchors yet. Run
                      <code className="bg-muted mx-1 rounded px-1 py-0.5 font-mono text-[10px]">
                        npm run rebuild:reference-profiles
                      </code>
                      to build the corpus.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-4">
        <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
          {label}
        </span>
        <span className="text-2xl font-bold tabular-nums">{value}</span>
        {hint && (
          <span className="text-muted-foreground text-[11px] leading-snug">
            {hint}
          </span>
        )}
      </CardContent>
    </Card>
  );
}

function BucketBar({
  label,
  count,
  total,
}: {
  label: string;
  count: number;
  total: number;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground w-24 shrink-0">{label}</span>
      <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
        <div
          className="bg-primary/70 h-full rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-right tabular-nums">{count}</span>
    </div>
  );
}

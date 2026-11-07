import {
  adminFetch,
  requireAdminSession,
  type AdminCronJob,
  type AdminStats,
} from '@/lib/admin';
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
import { RunCronButton } from '../_components/RunCronButton';
import { compactNumber, formatTimestamp } from '../_components/format';

export const dynamic = 'force-dynamic';

const PIPELINE_LABELS: Record<string, string> = {
  DISCOVERY: 'Catalog discovery',
  STEAM_REVIEWS: 'Steam reviews',
  STEAM_REVIEWER_PLAYTIME: 'Steam reviewer playtime',
  STORE_RATINGS: 'PS / Xbox store ratings',
  ACHIEVEMENTS: 'Achievements',
  REFERENCE_PROFILE: 'Matcher anchors',
  ESTIMATE_REBUILD: 'Estimate rebuild',
  STEAM_CCU: 'Steam CCU',
  STEAM_PRICE: 'Steam prices',
  XBOX_PRICE: 'Xbox prices',
  PS_PRICE: 'PlayStation prices',
  TWITCH_VIEWERS: 'Twitch viewers',
  STEAM_POPULARITY: 'Steam followers',
};

// Jobs that loop the whole catalog once and have no row in the cron table.
const OTHER_JOB_DESCRIPTIONS: Record<string, string> = {
  'steam-reviews-health': 'Checks that Steam reviews are still being collected',
  'game-discovery': 'Admits new games from IGDB and Steam',
  'game-rank': 'Recomputes the home-grown rank',
  'blog-draft': 'Writes the weekly blog draft (AI call, never publishes)',
  'blog-news': 'Writes the daily blog news drafts (AI calls, never publishes)',
};

type Status = 'Complete' | 'Issues' | 'In progress' | 'Not started';

function cronName(cronPath: string): string {
  return cronPath.replace(/^\/api\/cron\//, '');
}

function formatCycle(start: string, end: string): string {
  const startedAt = new Date(start);
  const endsAt = new Date(end);
  const sameDay =
    startedAt.toISOString().slice(0, 10) === endsAt.toISOString().slice(0, 10);
  const format = (value: Date, includeDate: boolean) =>
    value.toLocaleString('en-US', {
      ...(includeDate ? { month: 'short', day: 'numeric' } : {}),
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
      hour12: false,
    });

  return `${format(startedAt, true)} → ${format(endsAt, !sameDay)} UTC`;
}

function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge
      variant={
        status === 'Complete'
          ? 'default'
          : status === 'Issues'
            ? 'destructive'
            : 'secondary'
      }
    >
      {status}
    </Badge>
  );
}

function PipelineRow({
  pipeline,
  running,
}: {
  pipeline: AdminStats['ingestionPipelines'][number];
  running: boolean;
}) {
  const percent =
    pipeline.total > 0
      ? Math.round((pipeline.cycleSucceeded / pipeline.total) * 100)
      : 100;
  const remaining = Math.max(pipeline.total - pipeline.cycleSucceeded, 0);
  const status: Status =
    pipeline.cycleFailed > 0
      ? 'Issues'
      : remaining === 0
        ? 'Complete'
        : pipeline.cycleAttempted > 0
          ? 'In progress'
          : 'Not started';

  return (
    <TableRow>
      <TableCell>
        <p className="font-medium">
          {PIPELINE_LABELS[pipeline.pipeline] ?? pipeline.pipeline}
        </p>
        <code className="text-muted-foreground text-xs">
          {pipeline.cronPath}
        </code>
      </TableCell>
      <TableCell>
        <p className="whitespace-nowrap text-sm">{pipeline.cadence}</p>
        <code className="text-muted-foreground whitespace-nowrap text-xs">
          {pipeline.schedule}
        </code>
      </TableCell>
      <TableCell className="text-muted-foreground whitespace-nowrap text-xs">
        {formatCycle(pipeline.cycleStartedAt, pipeline.cycleEndsAt)}
      </TableCell>
      <TableCell className="tabular-nums">
        <p className="whitespace-nowrap">
          {pipeline.cycleSucceeded.toLocaleString()} /{' '}
          {pipeline.total.toLocaleString()} ({percent}%)
        </p>
        <p className="text-muted-foreground whitespace-nowrap text-xs">
          {pipeline.cycleAttempted.toLocaleString()} attempted
        </p>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {remaining.toLocaleString()}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <span
          className={pipeline.cycleFailed > 0 ? 'text-destructive' : undefined}
        >
          {pipeline.cycleFailed.toLocaleString()}
        </span>
      </TableCell>
      <TableCell>
        <StatusBadge status={status} />
      </TableCell>
      <TableCell className="text-muted-foreground whitespace-nowrap text-right text-xs">
        {formatTimestamp(pipeline.lastSuccessAt)}
      </TableCell>
      <TableCell className="text-right">
        <RunCronButton name={cronName(pipeline.cronPath)} running={running} />
      </TableCell>
    </TableRow>
  );
}

// Milestone harvest has no fixed cycle: each game is due when its age-based
// interval elapses, so "Remaining" is the number of games due right now.
function MilestoneHarvestRow({
  harvest,
  running,
}: {
  harvest: AdminStats['milestoneHarvest'];
  running: boolean;
}) {
  const status: Status =
    harvest.failedLast24h > 0
      ? 'Issues'
      : harvest.dueNow === 0
        ? 'Complete'
        : 'In progress';

  return (
    <TableRow>
      <TableCell>
        <p className="font-medium">Milestone harvest</p>
        <code className="text-muted-foreground text-xs">
          {harvest.cronPath}
        </code>
      </TableCell>
      <TableCell>
        <p className="whitespace-nowrap text-sm">Age-based (3d → 180d)</p>
        <code className="text-muted-foreground whitespace-nowrap text-xs">
          {harvest.schedule}
        </code>
      </TableCell>
      <TableCell className="text-muted-foreground whitespace-nowrap text-xs">
        Rolling, last 24h
      </TableCell>
      <TableCell className="tabular-nums">
        <p className="whitespace-nowrap">
          {harvest.checkedLast24h.toLocaleString()} checked /{' '}
          {harvest.eligible.toLocaleString()} eligible
        </p>
        <p className="text-muted-foreground whitespace-nowrap text-xs">
          ~{harvest.expectedPerDay.toLocaleString()}/day expected
        </p>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <p>{harvest.dueNow.toLocaleString()}</p>
        <p className="text-muted-foreground text-xs">due now</p>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <span
          className={harvest.failedLast24h > 0 ? 'text-destructive' : undefined}
        >
          {harvest.failedLast24h.toLocaleString()}
        </span>
      </TableCell>
      <TableCell>
        <StatusBadge status={status} />
      </TableCell>
      <TableCell className="text-muted-foreground whitespace-nowrap text-right text-xs">
        {formatTimestamp(harvest.lastSuccessAt)}
      </TableCell>
      <TableCell className="text-right">
        <RunCronButton name={cronName(harvest.cronPath)} running={running} />
      </TableCell>
    </TableRow>
  );
}

export default async function AdminCronsPage() {
  await requireAdminSession();
  const [stats, cronJobs] = await Promise.all([
    adminFetch<AdminStats>('/stats'),
    adminFetch<AdminCronJob[]>('/crons'),
  ]);

  const runningJobs = new Set(
    cronJobs.filter((job) => job.running).map((job) => job.name),
  );
  const tableJobs = new Set([
    ...stats.ingestionPipelines.map((p) => cronName(p.cronPath)),
    cronName(stats.milestoneHarvest.cronPath),
  ]);
  const otherJobs = cronJobs.filter((job) => !tableJobs.has(job.name));

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Crons</h1>
        <p className="text-muted-foreground text-sm">
          Scheduled jobs from <code>vercel.json</code>. &ldquo;Run&rdquo;
          starts one now in the background, the same work as a scheduled run;
          reload this page to follow it.
        </p>
      </header>

      <section>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold tracking-wide uppercase">
              Per-game pipelines
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-sm">
              {compactNumber(stats.signals.steamReviewsTotal)} Steam review
              snapshots stored. Last captured:{' '}
              <span className="text-foreground font-medium">
                {formatTimestamp(stats.signals.lastCapturedAt)}
              </span>
              .
            </p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cron</TableHead>
                    <TableHead>Cadence</TableHead>
                    <TableHead>Current cycle</TableHead>
                    <TableHead>Progress</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                    <TableHead className="text-right">Failed</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Last success</TableHead>
                    <TableHead className="text-right">Manual run</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.ingestionPipelines.map((pipeline) => (
                    <PipelineRow
                      key={pipeline.pipeline}
                      pipeline={pipeline}
                      running={runningJobs.has(cronName(pipeline.cronPath))}
                    />
                  ))}
                  <MilestoneHarvestRow
                    harvest={stats.milestoneHarvest}
                    running={runningJobs.has(
                      cronName(stats.milestoneHarvest.cronPath),
                    )}
                  />
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>

      {otherJobs.length > 0 && (
        <section>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold tracking-wide uppercase">
                Whole-catalog jobs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cron</TableHead>
                    <TableHead>What it does</TableHead>
                    <TableHead className="text-right">Manual run</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {otherJobs.map((job) => (
                    <TableRow key={job.name}>
                      <TableCell>
                        <code className="text-xs">{job.cronPath}</code>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {OTHER_JOB_DESCRIPTIONS[job.name] ?? '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <RunCronButton name={job.name} running={job.running} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}

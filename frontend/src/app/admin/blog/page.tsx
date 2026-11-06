import { Suspense } from 'react';
import Link from 'next/link';
import { requireAdminSession, adminFetch } from '@/lib/admin';
import type {
  AdminBlogCandidate,
  AdminBlogFormatCandidates,
  AdminBlogSummary,
  BlogPostStatus,
} from '@/lib/admin';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  GenerateBlogDraftButton,
  GenerateBlogFormatButton,
} from '../_components/GenerateBlogDraftButton';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<AdminBlogSummary['kind'], string | null> = {
  GAME_SALES_FACTS: null,
  SALES_NEWS: 'news',
  LAUNCH_REPORT: 'launch',
  SALES_RANKING: 'ranking',
};

const TABS: {
  id: BlogPostStatus | 'CANDIDATES' | 'FORMATS';
  label: string;
}[] = [
  { id: 'DRAFT', label: 'Drafts' },
  { id: 'PUBLISHED', label: 'Published' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: 'CANDIDATES', label: 'Candidates' },
  { id: 'FORMATS', label: 'News, launches, rankings' },
];

export default async function AdminBlogPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdminSession();
  const { status: raw } = await searchParams;
  const status = TABS.some((t) => t.id === raw)
    ? (raw as (typeof TABS)[number]['id'])
    : 'DRAFT';

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Blog</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          AI drafts stay private until you publish. One sales article per game
          and one ranking per publisher or franchise; when their figures change
          they get an update draft (Sunday cron or Regenerate) while the current
          version stays online. News items and launch reports come from a daily
          cron and are not updated.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Button
            key={tab.id}
            asChild
            size="sm"
            variant={status === tab.id ? 'default' : 'outline'}
          >
            <Link href={`/admin/blog?status=${tab.id}`}>{tab.label}</Link>
          </Button>
        ))}
      </div>
      <Suspense
        fallback={
          <p className="text-muted-foreground text-sm">Loading…</p>
        }
      >
        {status === 'CANDIDATES' ? (
          <CandidatesTable />
        ) : status === 'FORMATS' ? (
          <FormatCandidates />
        ) : (
          <PostsTable status={status} />
        )}
      </Suspense>
    </div>
  );
}

async function PostsTable({ status }: { status: BlogPostStatus }) {
  const { items } = await adminFetch<{ items: AdminBlogSummary[]; total: number }>(
    `/blog?status=${status}&limit=50`,
  );
  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">Nothing in this tab.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Game</TableHead>
          <TableHead>EN title</TableHead>
          <TableHead>Errors / issues / unverified</TableHead>
          <TableHead>Generated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <Link href={`/admin/blog/${row.id}`} className="hover:underline">
                {row.gameName ?? '—'}
              </Link>
              {KIND_LABEL[row.kind] && (
                <Badge variant="outline" className="ml-2">
                  {KIND_LABEL[row.kind]}
                </Badge>
              )}
              {row.isRefresh && (
                <Badge variant="outline" className="ml-2">
                  update
                </Badge>
              )}
              {row.freshness?.stale && (
                <Badge variant="destructive" className="ml-2">
                  outdated figures
                </Badge>
              )}
            </TableCell>
            <TableCell className="max-w-md truncate">
              {row.titles.en ?? '—'}
            </TableCell>
            <TableCell>
              <Badge variant="outline">
                {row.errorCount} / {row.issueCount} / {row.unverifiedCount}
              </Badge>
            </TableCell>
            <TableCell className="font-mono text-xs">
              {row.generatedAt
                ? new Date(row.generatedAt).toISOString().slice(0, 10)
                : '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

async function FormatCandidates() {
  const { news, launches, rankings } =
    await adminFetch<AdminBlogFormatCandidates>('/blog/format-candidates');
  const date = (iso: string) => new Date(iso).toISOString().slice(0, 10);
  const none = (
    <p className="text-muted-foreground text-sm">Nothing eligible right now.</p>
  );
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">News: new worldwide figures</h2>
        <p className="text-muted-foreground text-sm">
          At least 1M, collected in the last 7 days and announced up to 14 days
          before that, over 3% above the figure on file. One per game every 14
          days.
        </p>
        {news.length === 0 ? (
          none
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Game</TableHead>
                <TableHead>Copies</TableHead>
                <TableHead>Source type</TableHead>
                <TableHead>Reported</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {news.map((c) => (
                <TableRow key={c.milestoneId}>
                  <TableCell>
                    <Link
                      href={`/admin/games/${c.gameId}`}
                      className="hover:underline"
                    >
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono">
                    {c.units.toLocaleString('en-US')}
                  </TableCell>
                  <TableCell>{c.source}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {date(c.reportedAt)}
                  </TableCell>
                  <TableCell>
                    <GenerateBlogFormatButton
                      input={{ kind: 'SALES_NEWS', milestoneId: c.milestoneId }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Launch reports</h2>
        <p className="text-muted-foreground text-sm">
          CORE paid games 7 to 14 days after release, Steam peak of at least
          5,000. Games not on Steam are not covered.
        </p>
        {launches.length === 0 ? (
          none
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Game</TableHead>
                <TableHead>Steam peak</TableHead>
                <TableHead>Released</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {launches.map((c) => (
                <TableRow key={c.gameId}>
                  <TableCell>
                    <Link
                      href={`/admin/games/${c.gameId}`}
                      className="hover:underline"
                    >
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono">
                    {c.steamPeak.toLocaleString('en-US')}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {date(c.releaseDate)}
                  </TableCell>
                  <TableCell>
                    <GenerateBlogFormatButton
                      input={{ kind: 'LAUNCH_REPORT', gameId: c.gameId }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Rankings</h2>
        <p className="text-muted-foreground text-sm">
          Curated publishers and franchises with at least 5 CORE paid games
          that have a worldwide figure.
        </p>
        {rankings.length === 0 ? (
          none
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subject</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Games</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rankings.map((c) => (
                <TableRow key={`${c.subjectType}-${c.subjectKey}`}>
                  <TableCell>{c.name}</TableCell>
                  <TableCell>{c.subjectType}</TableCell>
                  <TableCell className="font-mono">{c.gameCount}</TableCell>
                  <TableCell>
                    <GenerateBlogFormatButton
                      input={{
                        kind: 'SALES_RANKING',
                        subjectType: c.subjectType,
                        subjectKey: c.subjectKey,
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

async function CandidatesTable() {
  const candidates = await adminFetch<AdminBlogCandidate[]>(
    '/blog/candidates?limit=40',
  );
  if (candidates.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No eligible CORE games left (need two sourced sales figures including
        Official, Wikipedia or Alinea).
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Score</TableHead>
          <TableHead>Game</TableHead>
          <TableHead>Why</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {candidates.map((c) => (
          <TableRow key={c.gameId}>
            <TableCell className="font-mono">{c.score}</TableCell>
            <TableCell>
              <Link
                href={`/admin/games/${c.gameId}`}
                className="hover:underline"
              >
                {c.name}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground max-w-xl text-xs">
              {c.reasons.join(' · ')}
            </TableCell>
            <TableCell>
              <GenerateBlogDraftButton gameId={c.gameId} label="Generate" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

import { Suspense } from 'react';
import Link from 'next/link';
import { requireAdminSession, adminFetch } from '@/lib/admin';
import type {
  AdminBlogCandidate,
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
import { GenerateBlogDraftButton } from '../_components/GenerateBlogDraftButton';

export const dynamic = 'force-dynamic';

const TABS: { id: BlogPostStatus | 'CANDIDATES'; label: string }[] = [
  { id: 'DRAFT', label: 'Drafts' },
  { id: 'PUBLISHED', label: 'Published' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: 'CANDIDATES', label: 'Candidates' },
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
          AI drafts stay private until you publish. One article per game.
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
          <TableHead>Issues</TableHead>
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
            </TableCell>
            <TableCell className="max-w-md truncate">
              {row.titles.en ?? '—'}
            </TableCell>
            <TableCell>
              <Badge variant="outline">
                {row.issueCount} / {row.unverifiedCount}
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

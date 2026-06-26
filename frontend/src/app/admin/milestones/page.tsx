import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import {
  adminFetch,
  type AdminMilestoneWithGame,
  type PaginatedAdmin,
} from '@/lib/admin';
import { Card, CardContent } from '@/components/ui/card';
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
import { Label } from '@/components/ui/label';
import { DeleteButton } from '../_components/DeleteButton';
import { deleteMilestone } from '../actions';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const SOURCES = ['OFFICIAL', 'WIKIPEDIA', 'ANNOUNCEMENT', 'MEDIA'];

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatScore(score: number | null): string {
  if (score == null) return '—';
  return `${Math.round(score)}`;
}

export default async function AdminMilestonesPage({
  searchParams,
}: {
  searchParams: Promise<{
    source?: string;
    undated?: string;
    suspect?: string;
    page?: string;
  }>;
}) {
  const { source, undated, suspect, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  if (source) params.set('source', source);
  if (undated === 'true') params.set('undated', 'true');
  if (suspect === 'true') params.set('suspect', 'true');

  const { items, total } = await adminFetch<
    PaginatedAdmin<AdminMilestoneWithGame>
  >(`/milestones?${params}`);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Milestones</h1>
        <p className="text-muted-foreground text-sm">
          {total.toLocaleString()} milestones. Most recently captured first.
        </p>
      </header>

      <Card>
        <CardContent className="pt-6">
          <form className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="source">Source</Label>
              <select
                id="source"
                name="source"
                defaultValue={source ?? ''}
                className="border-input bg-background h-9 rounded-md border px-3 text-sm shadow-xs"
              >
                <option value="">All</option>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-3">
              <label className="text-foreground flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="undated"
                  value="true"
                  defaultChecked={undated === 'true'}
                />
                Undated only
              </label>
              <label className="text-foreground flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="suspect"
                  value="true"
                  defaultChecked={suspect === 'true'}
                />
                Suspect quote only
              </label>
            </div>
            <Button type="submit">Apply</Button>
            <Button asChild variant="ghost">
              <Link href="/admin/milestones">Reset</Link>
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Game</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Units</TableHead>
              <TableHead className="text-right">Confidence</TableHead>
              <TableHead>Reported</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>Quote</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <Link
                    href={`/admin/games/${m.gameId}`}
                    className="hover:text-primary hover:underline"
                  >
                    {m.gameName}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{m.source}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {m.units.toLocaleString()}
                </TableCell>
                <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                  {formatScore(m.confidenceScore)}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatDate(m.reportedAt)}
                </TableCell>
                <TableCell>
                  {m.sourceUrl ? (
                    <a
                      href={m.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
                    >
                      link
                      <ExternalLink aria-hidden="true" className="size-3" />
                    </a>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground max-w-md truncate text-xs">
                  {m.note ?? '—'}
                </TableCell>
                <TableCell className="text-right">
                  <DeleteButton
                    action={deleteMilestone.bind(null, m.id)}
                    confirmMessage={`Delete this ${m.source} milestone for ${m.gameName}?`}
                    iconOnly
                    label="Delete milestone"
                  />
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-muted-foreground py-12 text-center"
                >
                  No milestones match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {pageCount > 1 && (
        <nav className="flex items-center justify-center gap-2">
          {page > 1 && (
            <Button asChild variant="outline" size="sm">
              <Link
                href={`?${new URLSearchParams({
                  ...(source ? { source } : {}),
                  ...(undated ? { undated } : {}),
                  ...(suspect ? { suspect } : {}),
                  page: String(page - 1),
                })}`}
              >
                ← Previous
              </Link>
            </Button>
          )}
          <span className="text-muted-foreground text-sm">
            Page {page} of {pageCount}
          </span>
          {page < pageCount && (
            <Button asChild variant="outline" size="sm">
              <Link
                href={`?${new URLSearchParams({
                  ...(source ? { source } : {}),
                  ...(undated ? { undated } : {}),
                  ...(suspect ? { suspect } : {}),
                  page: String(page + 1),
                })}`}
              >
                Next →
              </Link>
            </Button>
          )}
        </nav>
      )}
    </div>
  );
}

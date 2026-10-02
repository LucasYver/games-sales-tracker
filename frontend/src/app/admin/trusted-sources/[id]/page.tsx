import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  adminFetch,
  type AdminTrustedSourceMilestones,
} from '@/lib/admin';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MilestoneRow } from '../../_components/MilestoneRow';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function AdminTrustedSourceMilestonesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const { source, items, total } = await adminFetch<AdminTrustedSourceMilestones>(
    `/trusted-sources/${id}/milestones?limit=${PAGE_SIZE}&offset=${offset}`,
  );

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hostLabel = source.host ?? (source.handle ? `@${source.handle}` : null);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href="/admin/trusted-sources">
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to trusted sources
          </Link>
        </Button>
      </div>

      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{source.name}</h1>
          {!source.active && <Badge variant="secondary">Inactive</Badge>}
          {source.autoCreated && (
            <Badge
              variant="outline"
              className="border-amber-300 bg-amber-50 text-[10px] tracking-wide text-amber-800 uppercase dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200"
            >
              auto
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground mt-1 font-mono text-xs">
          {source.slug}
          {hostLabel ? ` · ${hostLabel}` : ''}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge variant="outline">{source.category}</Badge>
          <Badge variant="secondary">{source.salesSource}</Badge>
          <Badge variant="outline">{source.language}</Badge>
        </div>
        <p className="text-muted-foreground mt-3 text-sm">
          {total.toLocaleString()} milestone{total === 1 ? '' : 's'} linked by
          hostname
          {source.host ? ` (${source.host})` : ''}.
        </p>
      </header>

      {!source.host ? (
        <Card>
          <p className="text-muted-foreground p-6 text-sm">
            This source has no host, so milestones cannot be matched to it.
          </p>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Game</TableHead>
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
              {items.map((m) => (
                <MilestoneRow key={m.id} milestone={m} gameName={m.gameName} />
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="text-muted-foreground py-12 text-center"
                  >
                    No milestones linked to this source.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {source.host && pageCount > 1 && (
        <nav className="flex items-center justify-center gap-2">
          {page > 1 && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/trusted-sources/${id}?page=${page - 1}`}>
                ← Previous
              </Link>
            </Button>
          )}
          <span className="text-muted-foreground text-sm">
            Page {page} of {pageCount}
          </span>
          {page < pageCount && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/trusted-sources/${id}?page=${page + 1}`}>
                Next →
              </Link>
            </Button>
          )}
        </nav>
      )}
    </div>
  );
}

import Link from 'next/link';
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
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { MilestoneRow } from '../_components/MilestoneRow';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const SOURCES = ['OFFICIAL', 'WIKIPEDIA', 'ANNOUNCEMENT', 'MEDIA'];

/**
 * Column header that drives server-side sorting via query params. Clicking
 * an inactive column sorts it descending; clicking the active column toggles
 * the direction. Resets to page 1 by omitting the `page` param.
 */
function SortableHead({
  column,
  label,
  sort,
  direction,
  filters,
}: {
  column: string;
  label: string;
  sort?: string;
  direction?: string;
  filters: Record<string, string>;
}) {
  const isActive = sort === column;
  const currentDir = isActive ? (direction === 'asc' ? 'asc' : 'desc') : null;
  const nextDir = currentDir === 'desc' ? 'asc' : 'desc';
  const indicator = !isActive ? '↕' : currentDir === 'asc' ? '↑' : '↓';
  const href = `?${new URLSearchParams({
    ...filters,
    sort: column,
    direction: nextDir,
  })}`;

  return (
    <TableHead>
      <Link
        href={href}
        className={`hover:text-foreground inline-flex items-center gap-1 ${
          isActive ? 'text-foreground' : ''
        }`}
      >
        {label}
        <span className={`text-xs ${isActive ? '' : 'opacity-40'}`}>
          {indicator}
        </span>
      </Link>
    </TableHead>
  );
}

export default async function AdminMilestonesPage({
  searchParams,
}: {
  searchParams: Promise<{
    source?: string;
    sort?: string;
    direction?: string;
    page?: string;
  }>;
}) {
  const { source, sort, direction, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Default matches the API: capturedAt DESC (most recently created first).
  const activeSort =
    sort === 'reportedAt' || sort === 'capturedAt' ? sort : 'capturedAt';
  const activeDirection = direction === 'asc' ? 'asc' : 'desc';

  // Active filters/sort shared by the fetch query and the pagination links.
  // Only persist sort params when they diverge from the default so Reset /
  // bare URLs stay clean.
  const filters: Record<string, string> = {};
  if (source) filters.source = source;
  if (activeSort !== 'capturedAt' || activeDirection !== 'desc') {
    filters.sort = activeSort;
    filters.direction = activeDirection;
  }

  const params = new URLSearchParams({
    ...filters,
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });

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
            {filters.sort && (
              <input type="hidden" name="sort" value={filters.sort} />
            )}
            {filters.direction && (
              <input type="hidden" name="direction" value={filters.direction} />
            )}
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
            <Button type="submit">Apply</Button>
            <Button asChild variant="ghost">
              <Link href="/admin/milestones">Reset</Link>
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[18%]">Game</TableHead>
              <TableHead className="w-[12%]">Source tier</TableHead>
              <TableHead className="w-[12%]">Reported by</TableHead>
              <TableHead className="w-[12%]">Attribution</TableHead>
              <TableHead className="w-[10%] text-right">Units</TableHead>
              <SortableHead
                column="reportedAt"
                label="Reported"
                sort={activeSort}
                direction={activeDirection}
                filters={filters}
              />
              <SortableHead
                column="capturedAt"
                label="Created"
                sort={activeSort}
                direction={activeDirection}
                filters={filters}
              />
              <TableHead>Note</TableHead>
              <TableHead className="w-[88px] text-right">Actions</TableHead>
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
                  ...filters,
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
                  ...filters,
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

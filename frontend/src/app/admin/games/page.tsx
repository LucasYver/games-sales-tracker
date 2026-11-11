import Link from 'next/link';
import {
  adminFetch,
  type AdminGameSummary,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DeleteButton } from '../_components/DeleteButton';
import { deleteGame } from '../actions';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Column header that drives server-side sorting via query params. Clicking
 * an inactive column sorts it descending; clicking the active column toggles
 * the direction. Resets to page 1 by omitting the `page` param.
 */
function SortableHead({
  column,
  label,
  align = 'left',
  sort,
  direction,
  filters,
}: {
  column: string;
  label: string;
  align?: 'left' | 'right';
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
    <TableHead className={align === 'right' ? 'text-right' : undefined}>
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

export default async function AdminGamesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    direction?: string;
    page?: string;
  }>;
}) {
  const {
    q,
    sort,
    direction,
    page: pageParam,
  } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Active filters/sort shared by the fetch query and the pagination links.
  const filters: Record<string, string> = {};
  if (q) filters.q = q;
  if (sort) filters.sort = sort;
  if (direction) filters.direction = direction;

  const params = new URLSearchParams({
    ...filters,
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });

  const { items, total } = await adminFetch<PaginatedAdmin<AdminGameSummary>>(
    `/games?${params}`,
  );

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Games</h1>
        <p className="text-muted-foreground text-sm">
          {total.toLocaleString()} tracked games. Most-recently updated first.
        </p>
      </header>

      <Card>
        <CardContent className="pt-6">
          <form className="flex flex-wrap items-end gap-4">
            <div className="flex min-w-[16rem] flex-1 flex-col gap-1.5">
              <Label htmlFor="q">Search by name</Label>
              <Input id="q" name="q" defaultValue={q ?? ''} placeholder="Halo, Witcher…" />
            </div>
            <Button type="submit">Apply</Button>
            <Button asChild variant="ghost">
              <Link href="/admin/games">Reset</Link>
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Platforms</TableHead>
              <SortableHead
                column="releaseDate"
                label="Released"
                sort={sort}
                direction={direction}
                filters={filters}
              />
              <TableHead className="text-right">Milestone</TableHead>
              <TableHead className="text-right">Estimate</TableHead>
              <SortableHead
                column="created"
                label="Added"
                align="right"
                sort={sort}
                direction={direction}
                filters={filters}
              />
              <SortableHead
                column="lastRefreshed"
                label="Last refresh"
                align="right"
                sort={sort}
                direction={direction}
                filters={filters}
              />
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((g) => (
              <TableRow key={g.id}>
                <TableCell>
                  <Link
                    href={`/admin/games/${g.id}`}
                    className="hover:text-primary font-medium hover:underline"
                  >
                    {g.name}
                  </Link>
                  <Badge
                    variant={g.catalogTier === 'CORE' ? 'default' : 'outline'}
                    className="ml-2 text-xs"
                  >
                    {g.catalogTier === 'CORE' ? 'Core' : 'Extended'}
                  </Badge>
                  {g.isFree && (
                    <Badge variant="outline" className="ml-2 text-xs">
                      F2P
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {g.platforms.map((p) => (
                      <Badge key={p} variant="secondary" className="text-xs">
                        {p}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatDate(g.releaseDate)}
                </TableCell>
                <TableCell className="text-right">
                  {g.hasMilestone ? 'Yes' : '—'}
                </TableCell>
                <TableCell className="text-right">
                  {g.hasEstimate ? 'Yes' : '—'}
                </TableCell>
                <TableCell className="text-muted-foreground text-right text-sm">
                  {formatDate(g.createdAt)}
                </TableCell>
                <TableCell className="text-muted-foreground text-right text-sm">
                  {formatDate(g.lastRefreshedAt)}
                </TableCell>
                <TableCell className="text-right">
                  <DeleteButton
                    action={deleteGame.bind(null, g.id)}
                    confirmMessage={`Delete "${g.name}" and all its sales records / estimates / signals?`}
                    iconOnly
                    label={`Delete ${g.name}`}
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
                  No games match this search.
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

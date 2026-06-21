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
const VALID_PLATFORMS = ['PC', 'PLAYSTATION', 'XBOX', 'SWITCH', 'MOBILE'];

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default async function AdminGamesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    platform?: string;
    hasSales?: string;
    page?: string;
  }>;
}) {
  const { q, platform, hasSales, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  if (q) params.set('q', q);
  if (platform) params.set('platform', platform);
  if (hasSales) params.set('hasSales', hasSales);

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
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="platform">Platform</Label>
              <select
                id="platform"
                name="platform"
                defaultValue={platform ?? ''}
                className="border-input bg-background h-9 rounded-md border px-3 text-sm shadow-xs"
              >
                <option value="">All</option>
                {VALID_PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="hasSales">Sales records</Label>
              <select
                id="hasSales"
                name="hasSales"
                defaultValue={hasSales ?? ''}
                className="border-input bg-background h-9 rounded-md border px-3 text-sm shadow-xs"
              >
                <option value="">Any</option>
                <option value="true">With sales</option>
                <option value="false">Without sales</option>
              </select>
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
              <TableHead>Released</TableHead>
              <TableHead className="text-right">Reviews</TableHead>
              <TableHead className="text-right">Sales records</TableHead>
              <TableHead className="text-right">Estimates</TableHead>
              <TableHead className="text-right">Calibrated</TableHead>
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
                <TableCell className="text-right tabular-nums">
                  {g.latestReviews?.toLocaleString() ?? '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {g.salesRecordsCount}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {g.estimatesCount}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {[
                    g.calibratedMultiplier != null
                      ? `PC ${g.calibratedMultiplier.toFixed(1)}x`
                      : null,
                    g.calibratedPsMultiplier != null
                      ? `PS ${g.calibratedPsMultiplier.toFixed(1)}x`
                      : null,
                    g.calibratedXboxMultiplier != null
                      ? `Xb ${g.calibratedXboxMultiplier.toFixed(1)}x`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
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
                  No games match these filters.
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
                  ...(q ? { q } : {}),
                  ...(platform ? { platform } : {}),
                  ...(hasSales ? { hasSales } : {}),
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
                  ...(q ? { q } : {}),
                  ...(platform ? { platform } : {}),
                  ...(hasSales ? { hasSales } : {}),
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

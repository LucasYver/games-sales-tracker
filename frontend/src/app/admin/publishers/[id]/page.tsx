import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { adminFetch, type AdminPublisherDetail } from '@/lib/admin';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { LauncherProfileSelect } from '../../_components/LauncherProfileSelect';
import { LauncherProfileBadge } from '../../_components/LauncherProfileBadge';

export const dynamic = 'force-dynamic';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default async function AdminPublisherDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const publisher = await adminFetch<AdminPublisherDetail>(`/publishers/${id}`);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href="/admin/publishers">
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to publishers
          </Link>
        </Button>
      </div>

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{publisher.name}</h1>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            {publisher.id}
          </p>
          <div className="mt-2">
            <LauncherProfileBadge profile={publisher.launcherProfile} />
          </div>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold tracking-wide uppercase">
            Launcher profile
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            How representative Steam is of this publisher&apos;s PC sales.
            Changes here persist in DB and are inherited by every game linked
            via the publisher FK.
          </p>
          <LauncherProfileSelect
            publisherId={publisher.id}
            current={publisher.launcherProfile}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold tracking-wide uppercase">
            Games ({publisher.gameCount})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {publisher.games.length === 0 ? (
            <p className="text-muted-foreground p-6 text-sm">
              No games linked to this publisher yet. Run the backfill from the
              publishers list to re-scan.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Release</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {publisher.games.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell>
                      <Link
                        href={`/admin/games/${g.id}`}
                        className="text-primary hover:underline"
                      >
                        {g.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{g.slug}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDate(g.releaseDate)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

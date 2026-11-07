import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { adminFetch, type AdminDeveloperDetail } from '@/lib/admin';
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

export const dynamic = 'force-dynamic';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default async function AdminDeveloperDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const developer = await adminFetch<AdminDeveloperDetail>(`/developers/${id}`);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href="/admin/developers">
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to developers
          </Link>
        </Button>
      </div>

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{developer.name}</h1>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            {developer.id}
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold tracking-wide uppercase">
            Games ({developer.gameCount})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {developer.games.length === 0 ? (
            <p className="text-muted-foreground p-6 text-sm">
              No games linked to this developer yet. Run the backfill from the
              developers list to re-scan.
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
                {developer.games.map((g) => (
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

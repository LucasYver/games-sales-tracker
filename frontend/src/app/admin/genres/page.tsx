import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { adminFetch, type AdminGenreRow } from '@/lib/admin';
import { GenresSyncButton } from '../_components/GenresSyncButton';

export const dynamic = 'force-dynamic';

export default async function AdminGenresPage() {
  const genres = await adminFetch<AdminGenreRow[]>('/genres');

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8">
      <header className="flex items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold tracking-tight">Genres</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Granular taxonomy sourced from IGDB, used for classification and
            display only. Sales estimation is driven entirely by the
            data-driven matcher (see <strong>Reference profiles</strong>), so
            genres no longer feed the model. Re-run the IGDB sync to refresh the
            catalog.
          </p>
        </div>
        <GenresSyncButton />
      </header>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>External ID</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {genres.map((g) => (
              <TableRow key={g.id}>
                <TableCell className="font-medium">
                  <div>{g.name}</div>
                  <div className="text-muted-foreground font-mono text-[10px]">
                    {g.slug}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{g.source}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs tabular-nums">
                  {g.externalId ?? '—'}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {new Date(g.updatedAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </TableCell>
              </TableRow>
            ))}
            {genres.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-muted-foreground py-12 text-center"
                >
                  No genres yet. Hit the
                  <code className="bg-muted mx-1 rounded px-1 py-0.5 font-mono text-[10px]">
                    Sync IGDB genres
                  </code>
                  button above to pull the catalog.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

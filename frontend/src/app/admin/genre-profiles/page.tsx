import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  adminFetch,
  type AdminGenreProfile,
  type AdminGenreRow,
} from '@/lib/admin';
import { GenreAssignmentSelect } from '../_components/GenreAssignmentSelect';
import { GenreProfileRow } from '../_components/GenreProfileRow';
import { GenresSyncButton } from '../_components/GenresSyncButton';

export const dynamic = 'force-dynamic';

export default async function AdminGenreProfilesPage() {
  const [profiles, genres] = await Promise.all([
    adminFetch<AdminGenreProfile[]>('/genre-profiles'),
    adminFetch<AdminGenreRow[]>('/genres'),
  ]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-8">
      <header className="flex items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold tracking-tight">Genre profiles</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Empirical platform-split <em>and</em> lifecycle per game type. The
            shares feed the future console estimation method (CCU/reviews →
            PS/Xbox/Switch ventilation). The lifecycle columns (index, year-1
            multiplier, year-2 retention) feed the genre-aware refinement of
            the first-week extrapolation method. Edit values as new data lands.
          </p>
        </div>
        <GenresSyncButton />
      </header>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">PC</TableHead>
              <TableHead className="text-right">PS</TableHead>
              <TableHead className="text-right">Xbox</TableHead>
              <TableHead className="text-right">Switch</TableHead>
              <TableHead>Lean</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead className="text-right" title="Empirical normalised lifecycle index">
                Idx
              </TableHead>
              <TableHead
                className="text-right"
                title="Year-1 cumulative units / week-1 units"
              >
                ×Y1
              </TableHead>
              <TableHead
                className="text-right"
                title="All-time peak Steam CCU → week-1 units ratio (low–high)"
              >
                CCU→W1
              </TableHead>
              <TableHead title="Qualitative grade for year-2+ retention">
                Tenue Y2
              </TableHead>
              <TableHead>Driver</TableHead>
              <TableHead className="text-right">Genres</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {profiles.map((p) => (
              <GenreProfileRow key={p.id} profile={p} />
            ))}
            {profiles.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={14}
                  className="text-muted-foreground py-12 text-center"
                >
                  No genre profiles seeded.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight">
            Genres
            <Badge variant="outline" className="ml-2">
              {genres.length}
            </Badge>
          </h2>
          <p className="text-muted-foreground text-xs">
            Taxonomy tags sourced from IGDB. Each one points at most to one
            profile above. Unmapped genres show up as
            <code className="bg-muted mx-1 rounded px-1 py-0.5 font-mono text-[10px]">
              (unassigned)
            </code>
            — fix them by hand or re-run the IGDB sync.
          </p>
        </div>

        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>External ID</TableHead>
                <TableHead>Profile</TableHead>
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
                  <TableCell>
                    <GenreAssignmentSelect
                      genreId={g.id}
                      currentProfileId={g.profileId}
                      profiles={profiles}
                    />
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
                    colSpan={5}
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

        <Card>
          <CardContent className="text-muted-foreground pt-6 text-sm">
            Profiles are seeded by the
            <code className="bg-muted mx-1 rounded px-1 py-0.5 font-mono text-xs">
              AddGenreProfileAndGenre
            </code>
            migration. The genre catalog is populated by the same migration with
            a heuristic mapping; the
            <code className="bg-muted mx-1 rounded px-1 py-0.5 font-mono text-xs">
              Sync IGDB genres
            </code>
            button can be replayed any time to pull new entries IGDB introduces.
            New rows land unassigned and need a manual profile pick before they
            can be used downstream.
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

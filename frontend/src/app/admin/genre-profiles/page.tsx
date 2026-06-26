import Link from 'next/link';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  adminFetch,
  type AdminGenreProfile,
  type AdminGenreRow,
  type GenreConfidence,
  type Year2Retention,
} from '@/lib/admin';
import { GenreAssignmentSelect } from '../_components/GenreAssignmentSelect';
import { GenresSyncButton } from '../_components/GenresSyncButton';

export const dynamic = 'force-dynamic';

const CONFIDENCE_VARIANT: Record<
  GenreConfidence,
  'default' | 'secondary' | 'outline'
> = {
  HIGH: 'default',
  MEDIUM: 'secondary',
  LOW: 'outline',
};

const RETENTION_LABEL: Record<Year2Retention, string> = {
  NEGATIVE: 'Negative',
  VERY_LOW: 'Very low',
  LOW: 'Low',
  LOW_MEDIUM: 'Low-medium',
  MEDIUM: 'Medium',
  MEDIUM_HIGH: 'Medium-high',
  HIGH: 'High',
  VERY_HIGH: 'Very high',
};

const RETENTION_VARIANT: Record<
  Year2Retention,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  NEGATIVE: 'destructive',
  VERY_LOW: 'outline',
  LOW: 'outline',
  LOW_MEDIUM: 'secondary',
  MEDIUM: 'secondary',
  MEDIUM_HIGH: 'default',
  HIGH: 'default',
  VERY_HIGH: 'default',
};

export default async function AdminGenreProfilesPage() {
  const [profiles, genres] = await Promise.all([
    adminFetch<AdminGenreProfile[]>('/genre-profiles'),
    adminFetch<AdminGenreRow[]>('/genres'),
  ]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8">
      <header className="flex items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold tracking-tight">Genre profiles</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Empirical platform-split <em>and</em> lifecycle per game type. The
            shares drive the console estimation method (CCU/reviews → PS / Xbox
            / Switch ventilation); the lifecycle columns (index, year-1
            multiplier, peak-CCU ratio, year-2 retention) drive the genre-aware
            first-week extrapolation. Each game stores the resolved profile (see
            the <strong>Genres</strong> tab for the auto-assignment rule). Open
            a profile to edit its values.
          </p>
        </div>
        <GenresSyncButton />
      </header>

      <Tabs defaultValue="profiles">
        <TabsList>
          <TabsTrigger value="profiles">
            Profiles
            <Badge variant="secondary" className="ml-1.5">
              {profiles.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="genres">
            Genres
            <Badge variant="secondary" className="ml-1.5">
              {genres.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profiles">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">PC</TableHead>
                  <TableHead className="text-right">PS</TableHead>
                  <TableHead className="text-right">Xbox</TableHead>
                  <TableHead className="text-right">Switch</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead
                    className="text-right"
                    title="Empirical normalised lifecycle index"
                  >
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
                  <TableHead className="text-right" title="Genres mapped to this profile">
                    Genres
                  </TableHead>
                  <TableHead className="text-right" title="Games currently using this profile">
                    Games
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profiles.map((p) => (
                  <TableRow key={p.id} className="hover:bg-muted/40">
                    <TableCell className="font-medium">
                      <Link
                        href={`/admin/genre-profiles/${p.id}`}
                        className="hover:underline"
                      >
                        {p.name}
                      </Link>
                      <div className="text-muted-foreground font-mono text-[10px]">
                        {p.slug}
                      </div>
                    </TableCell>
                    <ShareCell value={p.pcShare} />
                    <ShareCell value={p.playstationShare} />
                    <ShareCell value={p.xboxShare} />
                    <ShareCell value={p.switchShare} />
                    <TableCell>
                      <Badge variant={CONFIDENCE_VARIANT[p.confidence]}>
                        {p.confidence}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {p.lifecycleIndex.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      ×{p.firstWeekToYearOneMultiplier.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {p.peakCcuToWeekOneLow.toFixed(1)}–
                      {p.peakCcuToWeekOneHigh.toFixed(1)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={RETENTION_VARIANT[p.year2Retention]}>
                        {RETENTION_LABEL[p.year2Retention]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.genreCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.gameCount}
                    </TableCell>
                  </TableRow>
                ))}
                {profiles.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={12}
                      className="text-muted-foreground py-12 text-center"
                    >
                      No genre profiles seeded.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="genres" className="flex flex-col gap-3">
          <p className="text-muted-foreground text-xs">
            Auto-assignment rule: taxonomy tags sourced from IGDB, each pointing
            at most to one profile. At ingestion a game inherits the profile of
            its <strong>first matching genre</strong> (unless an admin pins one
            on the game). Unmapped genres show up as{' '}
            <code className="bg-muted mx-1 rounded px-1 py-0.5 font-mono text-[10px]">
              (unassigned)
            </code>
            — fix them by hand or re-run the IGDB sync.
          </p>
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
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ShareCell({ value }: { value: number }) {
  return (
    <TableCell className="text-right tabular-nums">
      {(value * 100).toFixed(1)}%
    </TableCell>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  adminFetch,
  type AdminGenreProfile,
  type AdminGenreRow,
} from '@/lib/admin';
import { GenreProfileEditor } from '../../_components/GenreProfileEditor';

export const dynamic = 'force-dynamic';

export default async function AdminGenreProfileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [profiles, genres] = await Promise.all([
    adminFetch<AdminGenreProfile[]>('/genre-profiles'),
    adminFetch<AdminGenreRow[]>('/genres'),
  ]);

  const profile = profiles.find((p) => p.id === id);
  if (!profile) notFound();

  const mappedGenres = genres.filter((g) => g.profileId === id);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-8">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href="/admin/genre-profiles">
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to genre profiles
          </Link>
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{profile.name}</h1>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            {profile.slug}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{profile.genreCount} genres</Badge>
          <Badge variant="outline">{profile.gameCount} games</Badge>
        </div>
      </header>

      <Card>
        <CardContent className="pt-6">
          <GenreProfileEditor profile={profile} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold tracking-wide uppercase">
            Mapped genres ({mappedGenres.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-3 text-xs">
            Genres whose auto-assignment rule points at this profile. A new game
            inherits this profile when one of these is its first matching genre.
            Reassign genres from the{' '}
            <Link
              href="/admin/genre-profiles"
              className="text-primary hover:underline"
            >
              Genres tab
            </Link>
            .
          </p>
          {mappedGenres.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No genre points at this profile yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {mappedGenres.map((g) => (
                <Badge key={g.id} variant="secondary" className="font-normal">
                  {g.name}
                  <span className="text-muted-foreground ml-1.5 font-mono text-[10px]">
                    {g.source}
                  </span>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

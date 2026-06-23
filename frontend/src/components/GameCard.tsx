import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { ImageOff } from 'lucide-react';
import type { PopularGame } from '@/lib/api';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

function releaseYear(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).getFullYear().toString();
}

type ReleaseStatus = 'upcoming' | 'new' | 'released' | 'unknown';

function releaseStatus(iso: string | null): ReleaseStatus {
  if (!iso) return 'unknown';
  const released = new Date(iso).getTime();
  if (Number.isNaN(released)) return 'unknown';
  const now = Date.now();
  if (released > now) return 'upcoming';
  const ageDays = (now - released) / (1000 * 60 * 60 * 24);
  if (ageDays <= 30) return 'new';
  return 'released';
}

export function GameCard({
  game,
  priority = false,
}: {
  game: PopularGame;
  priority?: boolean;
}) {
  const t = useTranslations('gameCard');
  const tCommon = useTranslations('common');
  const tPlatform = useTranslations('platform');

  const year = releaseYear(game.releaseDate);
  const status = releaseStatus(game.releaseDate);
  const visibleGenres = game.genres.slice(0, 2);

  return (
    <Link
      href={`/game/${game.slug}`}
      className="group focus-visible:ring-ring rounded-xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      aria-label={game.name}
    >
      <Card className="ring-foreground/10 h-full gap-0 overflow-hidden p-0 ring-1 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-lg group-hover:ring-foreground/20">
        <div className="bg-muted relative aspect-[460/215] w-full overflow-hidden">
          {game.coverUrl ? (
            <Image
              src={game.coverUrl}
              alt={`${game.name} cover`}
              fill
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              priority={priority}
              className="object-cover transition duration-300 group-hover:scale-[1.04]"
            />
          ) : (
            <div className="text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-1.5 text-xs">
              <ImageOff aria-hidden className="size-5 opacity-60" />
              {tCommon('noImage')}
            </div>
          )}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/40 to-transparent"
          />

          {status === 'new' && (
            <span className="absolute top-2 left-2 rounded-md bg-emerald-500/95 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-white uppercase shadow-sm">
              {t('newBadge')}
            </span>
          )}
          {status === 'upcoming' && (
            <span className="absolute top-2 left-2 rounded-md bg-primary/95 text-primary-foreground px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase shadow-sm">
              {t('upcomingBadge')}
            </span>
          )}

          {year && (
            <span className="absolute top-2 right-2 rounded-md border border-white/15 bg-black/45 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums backdrop-blur-sm">
              {year}
            </span>
          )}
        </div>

        <CardContent className="flex flex-1 flex-col gap-2.5 p-4">
          <h3 className="line-clamp-2 leading-tight font-semibold">
            {game.name}
          </h3>

          {game.isFree && (
            <p className="text-sm font-semibold text-emerald-600">
              {tCommon('freeToPlay')}
            </p>
          )}

          {visibleGenres.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {visibleGenres.map((g) => (
                <span
                  key={g}
                  className="text-muted-foreground bg-muted/70 rounded px-1.5 py-0.5 text-[10px] font-medium"
                >
                  {g}
                </span>
              ))}
            </div>
          )}

          {game.platforms.length > 0 && (
            <div className="mt-auto flex flex-wrap gap-1 pt-1">
              {game.platforms.map((p) => (
                <Badge
                  key={p}
                  variant="outline"
                  className="text-muted-foreground border-border/70 px-1.5 py-0 text-[10px] font-medium"
                >
                  {tPlatform(p)}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

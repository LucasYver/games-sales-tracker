import { useTranslations, useFormatter } from 'next-intl';
import type { PopularGame } from '@/lib/api';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

function releaseYear(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).getFullYear().toString();
}

export function GameCard({ game }: { game: PopularGame }) {
  const t = useTranslations('gameCard');
  const tCommon = useTranslations('common');
  const tPlatform = useTranslations('platform');
  const format = useFormatter();

  const year = releaseYear(game.releaseDate);
  const hasEstimate =
    game.estimatedLow !== null && game.estimatedHigh !== null;

  const compact = (n: number) =>
    format.number(n, { notation: 'compact', maximumFractionDigits: 1 });
  const range = (low: number, high: number) =>
    low === high ? compact(low) : `${compact(low)} – ${compact(high)}`;

  return (
    <Link
      href={`/game/${game.slug}`}
      className="group focus-visible:ring-ring rounded-xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      aria-label={game.name}
    >
      <Card className="h-full gap-0 overflow-hidden p-0 transition-shadow hover:shadow-md">
        <div className="bg-muted relative aspect-[460/215] w-full overflow-hidden">
          {game.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={game.coverUrl}
              alt={`${game.name} cover`}
              className="h-full w-full object-cover transition group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="text-muted-foreground flex h-full w-full items-center justify-center text-sm">
              {tCommon('noImage')}
            </div>
          )}
        </div>

        <CardContent className="flex flex-1 flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="leading-tight font-semibold">{game.name}</h3>
            {year && (
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {year}
              </span>
            )}
          </div>

          {game.isFree ? (
            <p className="text-sm font-medium text-emerald-600">
              {tCommon('freeToPlay')}
            </p>
          ) : hasEstimate ? (
            <p className="text-sm">
              <span className="text-primary font-semibold">
                {range(game.estimatedLow!, game.estimatedHigh!)}
              </span>{' '}
              <span className="text-muted-foreground">
                {tCommon('estimatedUnits')}
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">{t('noEstimate')}</p>
          )}

          <div className="mt-auto flex flex-wrap gap-1 pt-1">
            {game.platforms.map((p) => (
              <Badge key={p} variant="secondary" className="text-[11px]">
                {tPlatform(p)}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

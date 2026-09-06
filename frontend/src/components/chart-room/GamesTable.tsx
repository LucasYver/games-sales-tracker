import Image from 'next/image';
import { useFormatter, useTranslations } from 'next-intl';
import { listingUnits, type PopularGame } from '@/lib/api';
import { Link } from '@/i18n/navigation';

function year(iso: string | null): string | null {
  if (!iso) return null;
  const y = new Date(iso).getFullYear();
  return Number.isNaN(y) ? null : String(y);
}

/**
 * The listing: one row per game, ranked, with the sales figure as the anchor.
 * Below ~620px the platform and review columns fold into the line under the
 * title, so the table never scrolls sideways on a phone.
 */
export function GamesTable({
  games,
  offset,
}: {
  games: PopularGame[];
  offset: number;
}) {
  const t = useTranslations('table');
  const tCommon = useTranslations('common');
  const tPlatform = useTranslations('platform');
  const format = useFormatter();

  const compact = (n: number) =>
    format.number(n, { notation: 'compact', maximumFractionDigits: 1 });

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          <th
            scope="col"
            className="w-9 border-b border-border px-2 py-2 text-center font-mono text-[0.64rem] font-semibold tracking-wider text-muted-foreground uppercase"
          >
            #
          </th>
          <th scope="col" className="w-11 border-b border-border px-2 py-2">
            <span className="sr-only">{tCommon('noImage')}</span>
          </th>
          <th
            scope="col"
            className="border-b border-border px-2 py-2 text-left font-mono text-[0.64rem] font-semibold tracking-wider text-muted-foreground uppercase"
          >
            {t('game')}
          </th>
          <th
            scope="col"
            className="hidden border-b border-border px-2 py-2 text-left font-mono text-[0.64rem] font-semibold tracking-wider text-muted-foreground uppercase sm:table-cell"
          >
            {t('platforms')}
          </th>
          <th
            scope="col"
            className="border-b border-border px-2 py-2 text-right font-mono text-[0.64rem] font-semibold tracking-wider text-muted-foreground uppercase"
          >
            {t('sales')}
          </th>
          <th
            scope="col"
            className="hidden border-b border-border px-2 py-2 text-right font-mono text-[0.64rem] font-semibold tracking-wider text-muted-foreground uppercase md:table-cell"
          >
            {t('reviews')}
          </th>
        </tr>
      </thead>
      <tbody>
        {games.map((game, idx) => {
          const sold = listingUnits(game);
          const releaseYear = year(game.releaseDate);
          const meta = [game.genres[0], releaseYear]
            .filter(Boolean)
            .join(' · ');
          const platforms = game.platforms.map((p) => tPlatform(p)).join(' / ');

          return (
            <tr
              key={game.id}
              className="border-b border-border-soft odd:bg-surface-alt hover:bg-accent"
            >
              <td className="px-2 py-2 text-center font-mono text-muted-foreground tabular-nums">
                {offset + idx + 1}
              </td>
              <td className="px-2 py-2">
                <div className="relative size-8 overflow-hidden rounded-[2px] bg-muted">
                  {game.coverUrl && (
                    <Image
                      src={game.coverUrl}
                      alt=""
                      fill
                      sizes="32px"
                      className="object-cover"
                    />
                  )}
                </div>
              </td>
              <td className="min-w-0 px-2 py-2">
                <Link
                  href={`/game/${game.slug}`}
                  className="font-semibold text-foreground hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {game.name}
                </Link>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {meta}
                  <span className="sm:hidden">
                    {platforms && ` · ${platforms}`}
                  </span>
                  <span className="md:hidden">
                    {game.reviews > 0 &&
                      ` · ${t('reviewsCount', { count: compact(game.reviews) })}`}
                  </span>
                </div>
              </td>
              <td className="hidden px-2 py-2 sm:table-cell">
                <div className="flex flex-wrap gap-1">
                  {game.platforms.map((p) => (
                    <span
                      key={p}
                      className="border border-border px-1 py-0.5 font-mono text-[0.62rem] text-muted-foreground"
                    >
                      {tPlatform(p)}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums">
                {game.isFree ? (
                  <span className="text-source-official">
                    {tCommon('freeToPlay')}
                  </span>
                ) : sold ? (
                  compact(sold)
                ) : (
                  <span className="text-text-faint">—</span>
                )}
              </td>
              <td className="hidden px-2 py-2 text-right font-mono text-muted-foreground tabular-nums md:table-cell">
                {game.reviews > 0 ? compact(game.reviews) : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

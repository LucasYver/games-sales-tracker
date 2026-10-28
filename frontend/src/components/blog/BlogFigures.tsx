import { useFormatter, useTranslations } from 'next-intl';
import type { BlogFigures } from '@/lib/api';

// Sales table and popularity cards for blog articles. The numbers come from
// the article's fact pack, not from the text, so they are exact and never
// repeated in prose.

const SIGNAL_ORDER = [
  'STEAM_PEAK_CCU',
  'STEAM_REVIEWS',
  'PS_RATINGS',
  'XBOX_RATINGS',
] as const;

const SM_COLS: Record<number, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
};

type Format = ReturnType<typeof useFormatter>;

function monthYear(format: Format, iso: string | null): string {
  if (!iso) return '—';
  return format.dateTime(new Date(iso), {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

function fullDate(format: Format, iso: string | null): string {
  if (!iso) return '—';
  return format.dateTime(new Date(iso), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "8,06 millions" / "731 000": never rounds a figure into a new one. */
function copies(format: Format, value: number): string {
  return value >= 1_000_000
    ? format.number(value, {
        notation: 'compact',
        compactDisplay: 'long',
        maximumSignificantDigits: 4,
      })
    : format.number(value);
}

export function PopularityCards({
  signals,
}: {
  signals: BlogFigures['signals'];
}) {
  const t = useTranslations('blog.figures');
  const format = useFormatter();
  const cards = SIGNAL_ORDER.flatMap((metric) => {
    const signal = signals.find((s) => s.metric === metric);
    return signal ? [{ ...signal, metric }] : [];
  });
  if (cards.length === 0) return null;

  return (
    <section aria-labelledby="popularity-title" className="my-6">
      <p
        id="popularity-title"
        className="font-mono text-[0.68rem] tracking-wide text-text-faint uppercase"
      >
        {t('popularityTitle')}
      </p>
      <p className="mt-1 mb-3 text-sm text-muted-foreground">
        {t('popularityNote')}
      </p>
      <div
        className={`grid gap-px overflow-hidden border border-border bg-border ${
          cards.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
        } ${SM_COLS[cards.length]}`}
      >
        {cards.map((card, i) => {
          const lastOdd = cards.length % 2 === 1 && i === cards.length - 1;
          return (
            <div
              key={card.metric}
              className={`bg-card px-3 py-3 ${lastOdd ? 'col-span-2 sm:col-span-1' : ''}`}
            >
              <p
                className={`font-mono text-2xl leading-none font-bold tabular-nums ${
                  card.metric === 'STEAM_PEAK_CCU' ? 'text-primary' : ''
                }`}
              >
                {format.number(card.value)}
              </p>
              <p className="mt-2 text-xs font-medium">
                {t(`signals.${card.metric}.label`)}
              </p>
              <p className="mt-0.5 font-mono text-[0.68rem] text-text-faint">
                {t(`signals.${card.metric}.sub`, {
                  date: monthYear(format, card.date),
                })}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function SalesTable({ sales }: { sales: BlogFigures['sales'] }) {
  const t = useTranslations('blog.figures');
  const format = useFormatter();
  if (sales.length === 0) return null;

  const source = (row: BlogFigures['sales'][number]) => {
    const name = row.sourceName ?? t('pressReports');
    switch (row.sourceKind) {
      case 'estimate':
        return `${name} (${t('estimate')})`;
      case 'publisher-press':
        return `${name} (${t('press')})`;
      default:
        return name;
    }
  };
  const platformName = (platform: string) =>
    t.has(`platforms.${platform}`) ? t(`platforms.${platform}`) : platform;

  const worldwide = sales.filter((row) => row.platform === 'GLOBAL');
  const byPlatform = sales
    .filter((row) => row.platform !== 'GLOBAL')
    .sort((a, b) => a.platform.localeCompare(b.platform));

  const th =
    'border-b border-border px-2 py-1.5 font-mono text-[0.68rem] font-normal tracking-wide text-text-faint uppercase';
  const td = 'border-b border-border px-2 py-2 align-top';
  const num = `${td} font-mono font-semibold whitespace-nowrap tabular-nums`;
  const muted = (row: BlogFigures['sales'][number]) =>
    row.sourceKind === 'estimate' ? 'text-muted-foreground' : '';

  return (
    <div className="mb-6 space-y-6">
      {worldwide.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="mb-2 text-left text-xs text-muted-foreground">
              {t('worldwideCaption')}
            </caption>
            <thead>
              <tr>
                <th className={th}>{t('colDate')}</th>
                <th className={th}>{t('colCopies')}</th>
                <th className={th}>{t('colSource')}</th>
              </tr>
            </thead>
            <tbody>
              {worldwide.map((row) => (
                <tr
                  key={`${row.date}-${row.value}-${row.sourceKind}`}
                  className={muted(row)}
                >
                  <td className={`${td} whitespace-nowrap`}>
                    {fullDate(format, row.date)}
                  </td>
                  <td className={num}>{copies(format, row.value)}</td>
                  <td className={td}>{source(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {byPlatform.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="mb-2 text-left text-xs text-muted-foreground">
              {t('platformCaption')}
            </caption>
            <thead>
              <tr>
                <th className={th}>{t('colPlatform')}</th>
                <th className={th}>{t('colCopies')}</th>
                <th className={th}>{t('colSource')}</th>
              </tr>
            </thead>
            <tbody>
              {byPlatform.map((row) => (
                <tr
                  key={`${row.platform}-${row.date}-${row.value}`}
                  className={muted(row)}
                >
                  <td className={td}>{platformName(row.platform)}</td>
                  <td className={num}>{copies(format, row.value)}</td>
                  <td className={td}>
                    {source(row)}
                    <span className="block font-mono text-[0.68rem] text-text-faint">
                      {fullDate(format, row.date)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

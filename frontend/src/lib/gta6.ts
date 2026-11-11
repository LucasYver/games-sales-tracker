/**
 * The GTA 6 sales page. GTA 6's own figures come from the database (added in
 * the admin, served by /games/:slug/sales-timeline). The two benchmarks are
 * history: Take-Two's sell-in reports for its previous launches, verified by
 * hand on 2026-11-11, fixed here because they will never change.
 */

export const GTA6_SLUG = 'grand-theft-auto-vi';
export const GTA6_PATH = '/gta-6-sales';
/** Console launch, PS5 and Xbox Series. */
export const GTA6_LAUNCH = '2026-11-19';

export interface BenchmarkFigure {
  /** Units sold-in (shipped to stores) worldwide. */
  units: number;
  reportedAt: string;
  sourceUrl: string;
}

export interface Benchmark {
  key: 'gta5' | 'rdr2';
  name: string;
  slug: string;
  launch: string;
  figures: BenchmarkFigure[];
}

export const BENCHMARKS: Benchmark[] = [
  {
    key: 'gta5',
    name: 'Grand Theft Auto V',
    slug: 'grand-theft-auto-v',
    launch: '2013-09-17',
    figures: [
      {
        units: 29_000_000,
        reportedAt: '2013-10-29',
        sourceUrl:
          'https://gameinformer.com/b/news/archive/2013/10/29/grand-theft-auto-v-has-sold-29-million-copies.aspx',
      },
      {
        units: 32_500_000,
        reportedAt: '2014-02-03',
        sourceUrl:
          'https://taketwointeractivesoftwareinc.gcs-web.com/news-releases/news-release-details/take-two-interactive-software-inc-reports-strong-results-0',
      },
      {
        units: 33_000_000,
        reportedAt: '2014-05-13',
        sourceUrl:
          'https://taketwointeractivesoftwareinc.gcs-web.com/news-releases/news-release-details/take-two-interactive-software-inc-reports-record-results-fiscal',
      },
    ],
  },
  {
    key: 'rdr2',
    name: 'Red Dead Redemption 2',
    slug: 'red-dead-redemption-2',
    launch: '2018-10-26',
    figures: [
      {
        units: 17_000_000,
        reportedAt: '2018-11-07',
        sourceUrl: 'https://fortune.com/2018/11/07/red-dead-redemption-2-sales/',
      },
      {
        units: 23_000_000,
        reportedAt: '2019-02-06',
        sourceUrl:
          'https://www.dualshockers.com/red-dead-redemption-2-23-million-copies-shipped/',
      },
      {
        units: 24_000_000,
        reportedAt: '2019-05-13',
        sourceUrl:
          'https://mcvuk.com/take-two-ceo-talks-full-year-results-24m-copies-of-rdr-2-shipped-sales-up-by-47-per-cent-and-the-companys-e3-presence/',
      },
    ],
  },
];

const DAY_MS = 86_400_000;

/** Whole days from `from` to `to` (dates as YYYY-MM-DD or ISO). */
export function daysBetween(from: string, to: string | Date): number {
  const start = Date.parse(from.slice(0, 10));
  const end =
    typeof to === 'string' ? Date.parse(to.slice(0, 10)) : to.getTime();
  return Math.floor((end - start) / DAY_MS);
}

import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { localeLanguages, routing } from '@/i18n/routing';
import { SITE_URL } from '@/lib/site-url';
import { defaultOgImages } from '@/lib/og-meta';
import { getSalesTimeline } from '@/lib/api';
import { OutboundLink } from '@/components/OutboundLink';
import {
  BENCHMARKS,
  GTA6_LAUNCH,
  GTA6_PAGE_PUBLISHED,
  GTA6_PATH,
  GTA6_SLUG,
  daysBetween,
  latestGta6Figure as latestFigure,
} from '@/lib/gta6';
import { SiteHeader } from '@/components/chart-room/SiteHeader';
import {
  LaunchCurvesChart,
  type LaunchCurve,
} from '@/components/LaunchCurvesChart';

// Same window as the timeline fetch: a new figure is live within 5 minutes.
export const revalidate = 300;

function compact(units: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(units);
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const [t, timeline] = await Promise.all([
    getTranslations({ locale, namespace: 'gta6Sales' }),
    getSalesTimeline(GTA6_SLUG),
  ]);
  const latest = latestFigure(timeline?.figures ?? []);
  const title = latest
    ? t('metaTitleUnits', { units: compact(latest.units, locale) })
    : t('metaTitle');
  const description = t('metaDescription');
  const path = `/${locale}${GTA6_PATH}`;
  return {
    title,
    description,
    alternates: { canonical: path, languages: localeLanguages(GTA6_PATH) },
    openGraph: {
      title,
      description,
      type: 'article',
      locale,
      url: `${SITE_URL}${path}`,
      images: defaultOgImages(locale),
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value, hint }: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-[3px] border border-border bg-card px-4 py-3">
      <div className="font-mono text-[0.7rem] tracking-wider text-muted-foreground uppercase">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {hint && (
        <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}

const SOURCES = [
  'sourceTakeTwo',
  'sourceRockstar',
  'sourceAlinea',
  'sourceCharts',
] as const;

export default async function Gta6SalesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [t, tPlatform, format, timeline] = await Promise.all([
    getTranslations({ locale, namespace: 'gta6Sales' }),
    getTranslations({ locale, namespace: 'platform' }),
    getFormatter({ locale }),
    getSalesTimeline(GTA6_SLUG),
  ]);

  const launch = timeline?.releaseDate?.slice(0, 10) ?? GTA6_LAUNCH;
  const figures = timeline?.figures ?? [];
  const latest = latestFigure(figures);
  const day = daysBetween(launch, new Date());
  const released = day >= 0;
  const longDate = (iso: string) =>
    format.dateTime(new Date(iso.slice(0, 10)), {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
  const launchLabel = longDate(launch);

  const curves: LaunchCurve[] = [
    {
      key: 'gta6',
      label: 'GTA 6',
      points: [
        { day: 0, units: 0 },
        ...figures
          .filter((f) => f.platform === 'GLOBAL' && f.reportedAt)
          .map((f) => ({
            day: daysBetween(launch, f.reportedAt!),
            units: f.units,
          }))
          .filter((p) => p.day >= 0),
      ],
    },
    ...BENCHMARKS.map((b) => ({
      key: b.key,
      label: b.key === 'gta5' ? 'GTA V' : 'RDR2',
      points: [
        { day: 0, units: 0 },
        ...b.figures.map((f) => ({
          day: daysBetween(b.launch, f.reportedAt),
          units: f.units,
        })),
      ],
    })),
  ];

  // The direct answer to "how many copies has GTA 6 sold", phrased so a
  // search engine can lift it: the newest worldwide figure, its source, and
  // the platform split reported the same day when there is one.
  let answer: string | null = null;
  if (latest) {
    const latestDay = latest.reportedAt!.slice(0, 10);
    const sameDay = (platform: string) =>
      figures
        .filter(
          (f) =>
            f.platform === platform && f.reportedAt?.slice(0, 10) === latestDay,
        )
        .at(-1);
    // A credit that is a name ("Sensor Tower", "Take-Two") reads well in the
    // sentence; a generic one ("industry estimates") does not, so the source
    // site stands in for it.
    const credit = latest.publisher?.trim();
    const source =
      credit && /^\p{Lu}/u.test(credit) ? credit : hostOf(latest.sourceUrl);
    const values = {
      units: format.number(latest.units),
      date: longDate(latest.reportedAt!),
    };
    answer = source
      ? t('answerLatest', { ...values, source })
      : t('answerLatestNoSource', values);
    const ps = sameDay('PLAYSTATION');
    const xbox = sameDay('XBOX');
    if (ps && xbox) {
      answer += ` ${t('answerSplit', {
        ps: format.number(ps.units),
        xbox: format.number(xbox.units),
      })}`;
    }
  }
  const lead = released
    ? t('leadAwaiting', { date: launchLabel })
    : t('leadUpcoming', { date: launchLabel, days: -day });
  const updatedAt = timeline?.updatedAt ?? latest?.reportedAt ?? null;

  const pageUrl = `${SITE_URL}/${locale}${GTA6_PATH}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: latest
      ? t('metaTitleUnits', { units: compact(latest.units, locale) })
      : t('metaTitle'),
    description: t('metaDescription'),
    datePublished: GTA6_PAGE_PUBLISHED,
    dateModified: updatedAt ?? GTA6_PAGE_PUBLISHED,
    inLanguage: locale,
    about: {
      '@type': 'VideoGame',
      name: 'Grand Theft Auto VI',
      url: `${SITE_URL}/${locale}/game/${GTA6_SLUG}`,
    },
    author: { '@type': 'Organization', name: 'Game Sales Tracker', url: SITE_URL },
    publisher: {
      '@type': 'Organization',
      name: 'Game Sales Tracker',
      url: SITE_URL,
    },
    mainEntityOfPage: pageUrl,
  };

  const [gta5, rdr2] = BENCHMARKS;

  return (
    <main className="flex min-h-screen flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          // `<` escaped so a source name can never close the script tag.
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
      />
      <SiteHeader />
      <article className="mx-auto w-full max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {t('title')}
        </h1>
        {answer ? (
          <section
            aria-labelledby="gta6-answer"
            className="mt-4 rounded-[3px] border border-primary/40 bg-accent px-4 py-3 text-accent-foreground"
          >
            <h2 id="gta6-answer" className="text-base font-semibold">
              {t('answerQuestion')}
            </h2>
            <p className="mt-1 text-base leading-relaxed">{answer}</p>
          </section>
        ) : (
          <p className="mt-3 text-base leading-relaxed font-medium">{lead}</p>
        )}
        {updatedAt && (
          <p className="mt-2 text-xs text-muted-foreground">
            <time dateTime={updatedAt}>
              {t('updatedOn', { date: longDate(updatedAt) })}
            </time>
          </p>
        )}
        <p className="mt-2 text-sm text-muted-foreground">{t('intro')}</p>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label={t('statLatest')}
            value={latest ? compact(latest.units, locale) : '—'}
            hint={
              latest
                ? `${tPlatform(latest.platform)} · ${longDate(latest.reportedAt!)}`
                : t('statLatestNone')
            }
          />
          <Stat
            label={released ? t('statSinceLaunch') : t('statUntilLaunch')}
            value={t('days', { days: Math.abs(day) })}
            hint={`${launchLabel} · PS5, Xbox Series X|S`}
          />
          <Stat
            label={t('statBenchmark')}
            value={`${compact(rdr2.figures[0].units, locale)} · ${compact(gta5.figures[0].units, locale)}`}
            hint={t('statBenchmarkHint', {
              rdr2Days: daysBetween(rdr2.launch, rdr2.figures[0].reportedAt),
              gta5Days: daysBetween(gta5.launch, gta5.figures[0].reportedAt),
            })}
          />
        </div>

        <Section title={t('chartTitle')}>
          <p className="mb-4 text-sm text-muted-foreground">
            {t('chartBody')}
          </p>
          <div className="rounded-[3px] border border-border bg-card p-3">
            <LaunchCurvesChart curves={curves} />
          </div>
        </Section>

        <Section title={t('figuresTitle')}>
          {figures.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('figuresNone')}</p>
          ) : (
            <FiguresTable
              rows={[...figures].reverse().map((f) => ({
                date: f.reportedAt ? longDate(f.reportedAt) : '—',
                units: format.number(f.units),
                scope: tPlatform(f.platform),
                who: f.publisher ?? hostOf(f.sourceUrl) ?? '—',
                url: f.sourceUrl,
              }))}
              headers={[
                t('colDate'),
                t('colUnits'),
                t('colScope'),
                t('colSource'),
              ]}
            />
          )}
        </Section>

        <Section title={t('benchmarksTitle')}>
          <p className="mb-4 text-sm text-muted-foreground">
            {t('benchmarksBody')}
          </p>
          <FiguresTable
            rows={BENCHMARKS.flatMap((b) =>
              b.figures.map((f) => ({
                date: `${b.key === 'gta5' ? 'GTA V' : 'RDR2'} · ${t('dayAfter', {
                  day: daysBetween(b.launch, f.reportedAt),
                })}`,
                units: format.number(f.units),
                scope: longDate(f.reportedAt),
                who: 'Take-Two',
                url: f.sourceUrl,
              })),
            )}
            headers={[
              t('colGame'),
              t('colUnits'),
              t('colDate'),
              t('colSource'),
            ]}
          />
        </Section>

        <Section title={t('sourcesTitle')}>
          <ul className="list-disc space-y-1.5 ps-5 text-sm leading-relaxed text-muted-foreground">
            {SOURCES.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {t('sellIn')}
          </p>
        </Section>

        <Section title={t('noModelTitle')}>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t('noModelBody')}
          </p>
        </Section>

        <p className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link
            href={`/game/${GTA6_SLUG}`}
            className="text-primary hover:underline"
          >
            {t('linkGame')}
          </Link>
          <Link
            href={`/game/${gta5.slug}`}
            className="text-primary hover:underline"
          >
            Grand Theft Auto V
          </Link>
          <Link
            href={`/game/${rdr2.slug}`}
            className="text-primary hover:underline"
          >
            Red Dead Redemption 2
          </Link>
          <Link href="/methodology" className="text-primary hover:underline">
            {t('linkMethodology')}
          </Link>
        </p>
      </article>
    </main>
  );
}

function FiguresTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: {
    date: string;
    units: string;
    scope: string;
    who: string;
    url: string | null;
  }[];
}) {
  return (
    <div className="overflow-x-auto rounded-[3px] border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-start font-mono text-[0.7rem] tracking-wider text-muted-foreground uppercase">
            {headers.map((h, i) => (
              <th
                key={h}
                className={`px-3 py-2 font-medium ${i === 1 ? 'text-end' : ''}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0">
              <td className="px-3 py-2 whitespace-nowrap">{r.date}</td>
              <td className="px-3 py-2 text-end font-semibold tabular-nums whitespace-nowrap">
                {r.units}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                {r.scope}
              </td>
              <td className="px-3 py-2">
                {r.url ? (
                  <OutboundLink
                    from="gta-6-sales"
                    href={r.url}
                    target="_blank"
                    rel="noopener nofollow"
                    className="text-primary hover:underline"
                  >
                    {r.who}
                  </OutboundLink>
                ) : (
                  r.who
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

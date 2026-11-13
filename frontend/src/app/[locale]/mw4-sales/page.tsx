import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { OutboundLink } from '@/components/OutboundLink';
import { localeLanguages, routing } from '@/i18n/routing';
import { SITE_URL } from '@/lib/site-url';
import { defaultOgImages } from '@/lib/og-meta';
import {
  getSalesTimeline,
  getSteamReviewCurve,
  type SteamReviewCurve,
} from '@/lib/api';
import {
  MW4_BENCHMARKS,
  MW4_PATH,
  MW4_SLUG,
  sameAgeComparison,
} from '@/lib/mw4';
import { SiteHeader } from '@/components/chart-room/SiteHeader';
import {
  LaunchCurvesChart,
  type LaunchCurve,
} from '@/components/LaunchCurvesChart';

// The review cron runs daily; the curves are cached for an hour.
export const revalidate = 3600;

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** The day-0 point a curve starts from, then its measured points. */
function curvePoints(curve: SteamReviewCurve | null) {
  const points = curve?.points ?? [];
  const start = points[0]?.day === 0 ? [] : [{ day: 0, units: 0 }];
  return [...start, ...points.map((p) => ({ day: p.day, units: p.reviews }))];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'mw4Sales' });
  const title = t('metaTitle');
  const description = t('metaDescription');
  const path = `/${locale}${MW4_PATH}`;
  return {
    title,
    description,
    alternates: { canonical: path, languages: localeLanguages(MW4_PATH) },
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

function Stat({
  label,
  value,
  hint,
}: {
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

const CAVEATS = [
  'caveatNotSales',
  'caveatPcOnly',
  'caveatReception',
  'caveatYears',
  'caveatStopped',
] as const;

export default async function Mw4SalesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [t, tPlatform, format, mw4, timeline, ...benchmarkCurves] =
    await Promise.all([
      getTranslations({ locale, namespace: 'mw4Sales' }),
      getTranslations({ locale, namespace: 'platform' }),
      getFormatter({ locale }),
      getSteamReviewCurve(MW4_SLUG),
      getSalesTimeline(MW4_SLUG),
      ...MW4_BENCHMARKS.map((b) => getSteamReviewCurve(b.slug)),
    ]);

  const mw4Points = mw4?.points ?? [];
  const latest = mw4Points.at(-1) ?? null;
  const longDate = (iso: string) =>
    format.dateTime(new Date(iso.slice(0, 10)), {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
  const launchLabel = mw4?.launch ? longDate(mw4.launch) : null;
  const ratioLabel = (ratio: number) =>
    `×${format.number(ratio, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}`;

  const comparisons = MW4_BENCHMARKS.map((b, i) => ({
    benchmark: b,
    result: sameAgeComparison(mw4Points, benchmarkCurves[i]?.points ?? []),
  }));
  const [bo7] = comparisons;

  const curves: LaunchCurve[] = [
    { key: 'mw4', label: 'MW4', points: curvePoints(mw4) },
    ...MW4_BENCHMARKS.map((b, i) => ({
      key: b.key,
      label: b.label,
      points: curvePoints(benchmarkCurves[i]),
    })),
  ];
  // Twice MW4's age, so the benchmarks show where it may be heading.
  const maxDay = Math.min(730, Math.max(60, (latest?.day ?? 0) * 2));

  let lead: string;
  if (latest && bo7.result) {
    lead = t('leadComparison', {
      day: latest.day,
      reviews: format.number(latest.reviews),
      ratio: format.number(bo7.result.ratio, {
        maximumFractionDigits: 1,
        minimumFractionDigits: 1,
      }),
    });
  } else if (latest) {
    lead = t('leadReviews', {
      day: latest.day,
      reviews: format.number(latest.reviews),
    });
  } else {
    lead = t('leadNone');
  }

  const figures = timeline?.figures ?? [];

  return (
    <main className="flex min-h-screen flex-col">
      <SiteHeader />
      <article className="mx-auto w-full max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {t('title')}
        </h1>
        <p className="mt-3 text-base leading-relaxed font-medium">{lead}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t('intro')}</p>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label={t('statReviews')}
            value={latest ? format.number(latest.reviews) : '—'}
            hint={
              latest && launchLabel
                ? t('statReviewsHint', { day: latest.day, date: launchLabel })
                : undefined
            }
          />
          {comparisons.map(({ benchmark, result }) => (
            <Stat
              key={benchmark.key}
              label={t('statVersus', { game: benchmark.label })}
              value={result ? ratioLabel(result.ratio) : '—'}
              hint={
                result
                  ? t('statVersusHint', {
                      mw4: format.number(result.mw4.reviews),
                      mw4Day: result.mw4.day,
                      game: benchmark.label,
                      reviews: format.number(result.benchmark.reviews),
                      day: result.benchmark.day,
                    })
                  : t('statVersusNone')
              }
            />
          ))}
        </div>

        <Section title={t('chartTitle')}>
          <p className="mb-4 text-sm text-muted-foreground">
            {t('chartBody')}
          </p>
          <div className="rounded-[3px] border border-border bg-card p-3">
            <LaunchCurvesChart
              curves={curves}
              namespace="mw4Sales"
              maxDay={maxDay}
            />
          </div>
        </Section>

        <Section title={t('noFigureTitle')}>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t('noFigureBody')}
          </p>
        </Section>

        <Section title={t('caveatsTitle')}>
          <ul className="list-disc space-y-1.5 ps-5 text-sm leading-relaxed text-muted-foreground">
            {CAVEATS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </Section>

        <Section title={t('figuresTitle')}>
          {figures.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('figuresNone')}</p>
          ) : (
            <div className="overflow-x-auto rounded-[3px] border border-border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-start font-mono text-[0.7rem] tracking-wider text-muted-foreground uppercase">
                    <th className="px-3 py-2 font-medium">{t('colDate')}</th>
                    <th className="px-3 py-2 text-end font-medium">
                      {t('colUnits')}
                    </th>
                    <th className="px-3 py-2 font-medium">{t('colScope')}</th>
                    <th className="px-3 py-2 font-medium">{t('colSource')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...figures].reverse().map((f, i) => {
                    const who = f.publisher ?? hostOf(f.sourceUrl) ?? '—';
                    return (
                      <tr
                        key={i}
                        className="border-b border-border/60 last:border-0"
                      >
                        <td className="px-3 py-2 whitespace-nowrap">
                          {f.reportedAt ? longDate(f.reportedAt) : '—'}
                        </td>
                        <td className="px-3 py-2 text-end font-semibold tabular-nums whitespace-nowrap">
                          {format.number(f.units)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                          {tPlatform(f.platform)}
                        </td>
                        <td className="px-3 py-2">
                          {f.sourceUrl ? (
                            <OutboundLink
                              from="mw4-sales"
                              href={f.sourceUrl}
                              target="_blank"
                              rel="noopener nofollow"
                              className="text-primary hover:underline"
                            >
                              {who}
                            </OutboundLink>
                          ) : (
                            who
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <p className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link
            href={`/game/${MW4_SLUG}`}
            className="text-primary hover:underline"
          >
            {t('linkGame')}
          </Link>
          {MW4_BENCHMARKS.map((b) => (
            <Link
              key={b.key}
              href={`/game/${b.slug}`}
              className="text-primary hover:underline"
            >
              {b.name}
            </Link>
          ))}
          <Link href="/methodology" className="text-primary hover:underline">
            {t('linkMethodology')}
          </Link>
        </p>
      </article>
    </main>
  );
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

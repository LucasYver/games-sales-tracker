import type { Metadata } from "next";
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { localeLanguages, routing } from "@/i18n/routing";
import { SITE_URL } from "@/lib/site-url";
import { SiteHeader } from "@/components/chart-room/SiteHeader";
import { defaultOgImages } from "@/lib/og-meta";
import { API_URL, roundUnits, type GameDetail } from "@/lib/api";
import { gameName } from "@/lib/game-name";

// The same page for every visitor; the two example games are read once a day.
export const revalidate = 86_400;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "methodology" });
  const path = `/${locale}/methodology`;
  return {
    title: t("title"),
    description: t("metaDescription"),
    alternates: {
      canonical: path,
      languages: localeLanguages("/methodology"),
    },
    openGraph: {
      title: t("title"),
      description: t("metaDescription"),
      type: "article",
      locale,
      url: `${SITE_URL}${path}`,
      images: defaultOgImages(locale),
    },
  };
}

type T = Awaited<ReturnType<typeof getTranslations>>;
type Format = Awaited<ReturnType<typeof getFormatter>>;

const strong = (chunks: React.ReactNode) => (
  <strong className="font-semibold text-foreground">{chunks}</strong>
);

const LINK_CLASS = "text-primary hover:underline";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

const SIGNALS = [
  "signalReviews",
  "signalPlayers",
  "signalRatings",
  "signalFollowers",
  "signalAudience",
  "signalProfile",
  "signalTrackRecord",
] as const;

const ADJUSTMENTS = ["adjustAnchor", "adjustConsoles", "adjustRange"] as const;

const LIMITS = ["limitLaunchers", "limitLaunch", "limitNoSteam"] as const;

const NOT_ESTIMATED = [
  "notEstimatedOld",
  "notEstimatedFree",
  "notEstimatedUnreleased",
  "notEstimatedPlatforms",
] as const;

const MORE_GAMES = [
  { name: "Hades II", slug: "hades-ii" },
  { name: "ELDEN RING", slug: "elden-ring" },
  { name: "Hollow Knight: Silksong", slug: "hollow-knight-silksong" },
  { name: "Lies of P", slug: "lies-of-p" },
];

/**
 * Sales per Steam review of PC-only games whose sales were published
 * (ml2/README.md, "Review behaviour over time and by price"). `from` marks a
 * spread: the recent years range from 34 to 47 depending on the year.
 */
const PER_REVIEW_GROUPS = [
  {
    label: "perReviewByPrice",
    bars: [
      { label: "perReviewCheap", value: 64 },
      { label: "perReviewExpensive", value: 30 },
    ],
  },
  {
    label: "perReviewByEra",
    bars: [
      { label: "perReviewOld", value: 62 },
      { label: "perReviewRecent", value: 47, from: 34 },
    ],
  },
] as const;
const PER_REVIEW_MAX = 70;

/**
 * Typical error (geometric mean of estimate ÷ published figure), measured in
 * `ml2/` (README.md, skill continue-ml-v2). Never round these up: they are
 * the measured values.
 * - classic: Steam reviews × the best single coefficient, totals, CV (×1.84);
 * - all: the whole V2 system (model + anchoring + consoles) on every
 *   development total (×1.38);
 * - anchored: prequential anchoring test (×1.14);
 * - smallPc / pc: locked test, small PC games vs the 2018 Steam leak players
 *   (×1.24) and PC figures (×1.35).
 */
type FactorRow = {
  label: string;
  factor: number;
  tone: "best" | "ours" | "classic";
};

const COMPARE_ROWS: FactorRow[] = [
  { label: "compareClassic", factor: 1.84, tone: "classic" },
  { label: "compareOurs", factor: 1.38, tone: "ours" },
  { label: "compareAnchored", factor: 1.14, tone: "best" },
];

const ACCURACY_ROWS: FactorRow[] = [
  { label: "accuracyAnchored", factor: 1.14, tone: "best" },
  { label: "accuracySmallPc", factor: 1.24, tone: "ours" },
  { label: "accuracyPc", factor: 1.35, tone: "ours" },
  { label: "accuracyAll", factor: 1.38, tone: "ours" },
];

const FACTOR_MAX = 1.9;

const TONE_CLASS: Record<FactorRow["tone"], string> = {
  best: "bg-emerald-600 dark:bg-emerald-500",
  ours: "bg-primary",
  classic: "bg-muted-foreground/50",
};

/**
 * The two worked examples. `path` is how the V2 estimates each one today
 * (anchored on a published total, or the model alone): re-check it if an
 * example is swapped or a figure is published for the flop.
 */
const EXAMPLES = [
  { slug: "black-myth-wukong", kind: "hit" },
  { slug: "dustborn", kind: "flop" },
] as const;

type ExampleKind = (typeof EXAMPLES)[number]["kind"];

const RANGE_STRIP_FACTOR = 8;

async function getExampleGame(slug: string): Promise<GameDetail | null> {
  try {
    const res = await fetch(`${API_URL}/games/${encodeURIComponent(slug)}`, {
      next: { revalidate: 86_400 },
    });
    if (!res.ok) return null;
    return (await res.json()) as GameDetail;
  } catch {
    return null;
  }
}

function Kpi({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
        {value}
      </div>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">{label}</p>
    </div>
  );
}

function PerReviewChart({ t, format }: { t: T; format: Format }) {
  return (
    <figure className="rounded-lg border bg-card p-4 sm:p-5">
      <figcaption className="text-sm font-medium text-foreground">
        {t("perReviewChartTitle")}
      </figcaption>
      <div className="mt-4 space-y-5">
        {PER_REVIEW_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t(group.label)}
            </div>
            <dl className="mt-2 space-y-2">
              {group.bars.map((bar) => {
                const from = "from" in bar ? bar.from : null;
                const value =
                  from != null
                    ? t("perReviewSpread", {
                        from: format.number(from),
                        to: format.number(bar.value),
                      })
                    : format.number(bar.value);
                return (
                  <div
                    key={bar.label}
                    className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 sm:grid-cols-[12rem_1fr]"
                  >
                    <dt className="text-xs text-foreground">{t(bar.label)}</dt>
                    <dd className="flex items-center gap-2">
                      <div className="relative h-5 flex-1 overflow-hidden rounded-sm bg-muted">
                        {from != null && (
                          <div
                            className="absolute inset-y-0 start-0 bg-primary/35"
                            style={{
                              width: `${(bar.value / PER_REVIEW_MAX) * 100}%`,
                            }}
                          />
                        )}
                        <div
                          className="absolute inset-y-0 start-0 bg-primary"
                          style={{
                            width: `${((from ?? bar.value) / PER_REVIEW_MAX) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="w-14 shrink-0 text-end text-xs font-semibold text-foreground tabular-nums">
                        {value}
                      </span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        {t("perReviewChartNote")}
      </p>
    </figure>
  );
}

function FactorChart({
  title,
  note,
  rows,
  t,
  format,
}: {
  title: string;
  note: string;
  rows: FactorRow[];
  t: T;
  format: Format;
}) {
  return (
    <figure className="rounded-lg border bg-card p-4 sm:p-5">
      <figcaption className="text-sm font-medium text-foreground">
        {title}
      </figcaption>
      <dl className="mt-4 space-y-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 sm:grid-cols-[14rem_1fr]"
          >
            <dt className="text-xs text-foreground">{t(row.label)}</dt>
            <dd className="flex items-center gap-2">
              <div className="relative h-5 flex-1 overflow-hidden rounded-sm bg-muted">
                <div
                  className={`absolute inset-y-0 start-0 ${TONE_CLASS[row.tone]}`}
                  style={{
                    width: `${((row.factor - 1) / (FACTOR_MAX - 1)) * 100}%`,
                  }}
                />
              </div>
              <span className="w-14 shrink-0 text-end text-xs font-semibold text-foreground tabular-nums">
                ×
                {format.number(row.factor, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-muted-foreground">{note}</p>
    </figure>
  );
}

function compact(units: number, format: Format) {
  return format.number(roundUnits(units) ?? units, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
}

/** Two significant figures: 25, 120, 1,300. */
function roughly(n: number) {
  if (n < 10) return Math.round(n);
  const step = 10 ** (Math.floor(Math.log10(n)) - 1);
  return Math.round(n / step) * step;
}

function ExampleCard({
  game,
  kind,
  locale,
  t,
  format,
}: {
  game: GameDetail;
  kind: ExampleKind;
  locale: string;
  t: T;
  format: Format;
}) {
  const headline = game.headline;
  if (!headline) return null;
  const steam = game.storeRatings?.steam?.reviews ?? null;
  const ps = game.storeRatings?.playstation?.reviews ?? null;
  const xbox = game.storeRatings?.xbox?.reviews ?? null;
  const peak = game.peakCcu?.value ?? null;
  const name = gameName(game, locale);
  const year = game.releaseDate
    ? new Date(game.releaseDate).getUTCFullYear()
    : null;

  const signals = [
    { label: t("exampleSteamReviews"), value: steam },
    { label: t("examplePeakPlayers"), value: peak },
    { label: t("examplePsRatings"), value: ps },
    { label: t("exampleXboxRatings"), value: xbox },
  ].filter((s) => s.value != null && s.value > 0);

  // The same log-scale strip for every card, from the estimate ÷ 8 to × 8,
  // so a wider range reads as a wider band from one game to the other.
  const lo = Math.log(headline.units / RANGE_STRIP_FACTOR);
  const span = 2 * Math.log(RANGE_STRIP_FACTOR);
  const pos = (v: number) =>
    `${Math.min(100, Math.max(0, ((Math.log(v) - lo) / span) * 100))}%`;

  const hit = kind === "hit";
  return (
    <article className="flex flex-col rounded-lg border bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            hit
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
          }`}
        >
          {t(hit ? "hitTag" : "flopTag")}
        </span>
        <span className="text-[11px] font-medium text-muted-foreground">
          {t(hit ? "hitPath" : "flopPath")}
        </span>
      </div>
      <h3 className="mt-3 flex flex-wrap items-baseline gap-x-2 text-base font-semibold text-foreground">
        <Link href={`/game/${game.slug}`} className="hover:underline">
          {name}
        </Link>
        {year && (
          <span className="text-xs font-normal text-muted-foreground">
            {year}
          </span>
        )}
      </h3>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        {signals.map((s) => (
          <div key={s.label}>
            <dt className="text-[11px] text-muted-foreground">{s.label}</dt>
            <dd className="text-sm font-semibold text-foreground tabular-nums">
              {format.number(s.value!)}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 rounded-md bg-muted/60 p-3">
        <div className="text-[11px] text-muted-foreground">
          {t("exampleEstimate")}
        </div>
        <div className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
          {compact(headline.units, format)}
        </div>
        <div
          className="relative mt-3 h-2 rounded-full bg-border"
          aria-hidden="true"
        >
          <div
            className="absolute inset-y-0 rounded-full bg-primary/40"
            style={{
              insetInlineStart: pos(headline.low),
              width: `calc(${pos(headline.high)} - ${pos(headline.low)})`,
            }}
          />
          <div
            className="absolute -top-1 h-4 w-1 rounded-full bg-primary"
            style={{ insetInlineStart: pos(headline.units) }}
          />
        </div>
        <div className="mt-2 text-xs text-muted-foreground tabular-nums">
          {t("exampleRange", {
            low: compact(headline.low, format),
            high: compact(headline.high, format),
          })}
        </div>
        {steam != null && steam > 0 && (
          <div className="mt-1 text-xs text-muted-foreground">
            {t("examplePerReview", {
              count: format.number(roughly(headline.units / steam)),
            })}
          </div>
        )}
      </div>

      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        {t.rich(hit ? "hitBody" : "flopBody", { strong })}
      </p>
      <p className="mt-auto pt-3 text-sm">
        <Link href={`/game/${game.slug}`} className={LINK_CLASS}>
          {t("exampleLink")}
        </Link>
      </p>
    </article>
  );
}

export default async function MethodologyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, format, examples] = await Promise.all([
    getTranslations({ locale, namespace: "methodology" }),
    getFormatter({ locale }),
    Promise.all(
      EXAMPLES.map(async (e) => ({
        ...e,
        game: await getExampleGame(e.slug),
      })),
    ),
  ]);
  const shown = examples.filter((e) => e.game?.headline);

  return (
    <main className="flex min-h-screen flex-col">
      <SiteHeader />
      <article className="mx-auto w-full max-w-3xl px-4 py-8">
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-4 text-base leading-relaxed font-medium">
          {t("intro")}
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi value={t("kpiFiguresValue")} label={t("kpiFiguresLabel")} />
          <Kpi value={t("kpiErrorValue")} label={t("kpiErrorLabel")} />
          <Kpi value={t("kpiAnchorValue")} label={t("kpiAnchorLabel")} />
          <Kpi value={t("kpiRangeValue")} label={t("kpiRangeLabel")} />
        </div>

        <Section title={t("stepsTitle")}>
          <ol className="space-y-6">
            <li>
              <h3 className="text-base font-semibold text-foreground">
                {t("step1Title")}
              </h3>
              <p className="mt-1">{t("step1Body")}</p>
              <ul className="mt-2 list-disc space-y-1 ps-5">
                {SIGNALS.map((key) => (
                  <li key={key}>{t.rich(key, { strong })}</li>
                ))}
              </ul>
            </li>
            <li>
              <h3 className="text-base font-semibold text-foreground">
                {t("step2Title")}
              </h3>
              <p className="mt-1">{t("step2Body1")}</p>
              <p className="mt-2">{t("step2Body2")}</p>
            </li>
            <li>
              <h3 className="text-base font-semibold text-foreground">
                {t("step3Title")}
              </h3>
              <ul className="mt-2 list-disc space-y-2 ps-5">
                {ADJUSTMENTS.map((key) => (
                  <li key={key}>{t.rich(key, { strong })}</li>
                ))}
              </ul>
            </li>
          </ol>
        </Section>

        <Section title={t("perReviewTitle")}>
          <p>{t("perReviewBody")}</p>
          <PerReviewChart t={t} format={format} />
          <p>{t("perReviewConclusion")}</p>
        </Section>

        <Section title={t("compareTitle")}>
          <p>{t("compareBody")}</p>
          <FactorChart
            title={t("compareChartTitle")}
            note={t("compareChartNote")}
            rows={COMPARE_ROWS}
            t={t}
            format={format}
          />
          <p>{t.rich("compareConclusion", { strong })}</p>
        </Section>

        {shown.length > 0 && (
          <Section title={t("examplesTitle")}>
            <p>{t("examplesIntro")}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {shown.map((e) => (
                <ExampleCard
                  key={e.slug}
                  game={e.game!}
                  kind={e.kind}
                  locale={locale}
                  t={t}
                  format={format}
                />
              ))}
            </div>
            <p className="text-xs">{t("examplesNote")}</p>
          </Section>
        )}

        <Section title={t("accuracyTitle")}>
          <p>{t.rich("accuracyBody1", { strong })}</p>
          <FactorChart
            title={t("accuracyChartTitle")}
            note={t("accuracyChartNote")}
            rows={ACCURACY_ROWS}
            t={t}
            format={format}
          />
          <p>{t("accuracyBody2")}</p>
          <p>{t.rich("accuracyRange", { strong })}</p>
          <p className="rounded-lg border-s-4 border-primary bg-accent/50 px-4 py-3 text-foreground">
            {t.rich("accuracyProgress", { strong })}
          </p>
        </Section>

        <Section title={t("notEstimatedTitle")}>
          <ul className="list-disc space-y-1 ps-5">
            {NOT_ESTIMATED.map((key) => (
              <li key={key}>{t.rich(key, { strong })}</li>
            ))}
          </ul>
          <p>{t("notEstimatedBody")}</p>
        </Section>

        <Section title={t("readTitle")}>
          <p>{t("readBody1")}</p>
          <p>{t("readBody2")}</p>
          <p>{t("readBody3")}</p>
        </Section>

        <Section title={t("limitsTitle")}>
          <ul className="list-disc space-y-1 ps-5">
            {LIMITS.map((key) => (
              <li key={key}>{t.rich(key, { strong })}</li>
            ))}
          </ul>
          <p>{t("limitsBody")}</p>
        </Section>

        <Section title={t("moreTitle")}>
          <p>{t("moreBody")}</p>
          <ul className="list-disc space-y-1 ps-5">
            {MORE_GAMES.map((game) => (
              <li key={game.slug}>
                <Link href={`/game/${game.slug}`} className={LINK_CLASS}>
                  {game.name}
                </Link>
              </li>
            ))}
          </ul>
          <p>
            <Link href="/blog" className={LINK_CLASS}>
              {t("moreBlog")}
            </Link>
          </p>
        </Section>
      </article>
    </main>
  );
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';

/** What the caller already knows about the game, shown for real at once. */
export type GamePreview = {
  name: string;
  coverUrl: string | null;
  platforms: string[];
};

function Bone({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`skeleton-bone block ${className}`} />;
}

const LABEL =
  'font-mono text-[0.68rem] font-semibold tracking-widest text-muted-foreground uppercase';
const SECTION_TITLE = 'mb-3 font-mono text-[0.8rem] font-bold tracking-wider uppercase';

/**
 * Placeholder for a game page while it loads. Same structure, borders and
 * labels as the real page body below the site header, so the swap reads as
 * figures filling in rather than a new page. What the search hit already
 * gives (name, cover, platforms) is shown for real; only data waits.
 *
 * Not a route loading.tsx: a loading boundary above the game page starts
 * streaming before its notFound(), which turned unknown slugs into soft 404s.
 * Client code shows this instead while a navigation to a game is pending.
 */
export function GamePageSkeleton({ preview }: { preview?: GamePreview }) {
  const t = useTranslations('gamePage');
  const tPlatform = useTranslations('platform');

  return (
    <div
      className="mx-auto w-full max-w-6xl"
      role="status"
      aria-busy="true"
      aria-label={preview ? t('heading', { name: preview.name }) : undefined}
    >
      <nav className="border-b border-border-soft px-4 py-2 font-mono text-[0.72rem] text-text-faint">
        <span className="text-muted-foreground">{t('back')}</span>
        <span className="mx-2">/</span>
        {preview ? preview.name : <Bone className="inline-block h-3 w-28 align-middle" />}
      </nav>

      {/* Header */}
      <div className="flex items-start gap-4 border-b border-border px-4 py-4">
        <div className="relative size-14 shrink-0 overflow-hidden rounded-[3px] sm:size-16">
          {preview?.coverUrl ? (
            <Image
              src={preview.coverUrl}
              alt=""
              fill
              sizes="64px"
              className="object-cover"
            />
          ) : (
            <Bone className="size-full" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {preview ? (
            <p className="text-2xl leading-tight font-bold tracking-tight">
              {t('heading', { name: preview.name })}
            </p>
          ) : (
            <Bone className="h-7 w-2/3 max-w-md" />
          )}
          <Bone className="mt-2 h-4 w-24" />
          <Bone className="mt-2 h-4 w-64 max-w-full" />
          <div className="mt-2 flex flex-wrap gap-1">
            {preview && preview.platforms.length > 0
              ? preview.platforms.map((p) => (
                  <span
                    key={p}
                    className="border border-primary/40 bg-accent px-1.5 py-0.5 font-mono text-[0.68rem] text-primary"
                  >
                    {tPlatform(p)}
                  </span>
                ))
              : ['w-14', 'w-10', 'w-12'].map((w) => (
                  <Bone key={w} className={`h-5 ${w}`} />
                ))}
          </div>
          <div className="mt-3 flex max-w-[80ch] flex-col gap-1.5">
            <Bone className="h-3 w-full" />
            <Bone className="h-3 w-11/12" />
            <Bone className="h-3 w-3/5" />
          </div>
        </div>
      </div>

      {/* Sales headline */}
      <section className="border-b border-border px-4 py-5">
        <div className="grid gap-6 sm:grid-cols-3 sm:items-end">
          <div>
            <p className={LABEL}>{t('salesTitle')}</p>
            <Bone className="mt-1 h-10 w-52 sm:h-12" />
            <Bone className="mt-2 h-3 w-44" />
          </div>
          <div>
            <p className={LABEL}>{t('recentCcuLabel')}</p>
            <Bone className="mt-1 h-8 w-24 sm:h-9" />
            <Bone className="mt-2 h-3 w-32" />
          </div>
          <div>
            <p className={LABEL}>{t('peakCcuLabel')}</p>
            <Bone className="mt-1 h-8 w-28 sm:h-9" />
            <Bone className="mt-2 h-3 w-36" />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3 border-t border-border-soft pt-3">
          <Bone className="h-7 w-20" />
          <Bone className="h-3 w-28" />
        </div>
      </section>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border bg-surface-alt px-4 py-2">
        <span className="border border-primary/40 bg-accent px-2 py-1.5 font-mono text-[0.7rem] tracking-wide text-primary uppercase">
          {t('tabOverview')}
        </span>
        <span className="border border-transparent px-2 py-1.5 font-mono text-[0.7rem] tracking-wide text-muted-foreground uppercase">
          {t('tabPrice')}
        </span>
      </div>

      <div className="grid lg:grid-cols-[264px_minmax(0,1fr)]">
        <div className="lg:col-start-2 lg:row-start-1">
          {/* Platform breakdown */}
          <section className="border-b border-border px-4 py-5">
            <h2 className={SECTION_TITLE}>{t('platformsTitle')}</h2>
            <Bone className="mb-3 h-2 w-full" />
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 border-b border-border px-2 py-2 font-mono text-[0.64rem] font-semibold tracking-wider text-muted-foreground uppercase">
              <span>{t('platformColumn')}</span>
              <span className="text-end">{t('salesColumn')}</span>
              <span className="text-end">{t('shareColumn')}</span>
            </div>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b border-border-soft px-2 py-2.5"
              >
                <Bone className="h-3.5 w-24" />
                <Bone className="h-3.5 w-14" />
                <Bone className="h-3.5 w-10" />
              </div>
            ))}
          </section>

          {/* Chart */}
          <section className="border-b border-border px-4 py-5">
            <div className="mb-4 flex gap-1">
              <Bone className="h-7 w-12" />
              <Bone className="h-7 w-24" />
              <Bone className="h-7 w-14" />
            </div>
            <div className="relative h-56 overflow-hidden border border-border-soft">
              {[1, 2, 3].map((i) => (
                <span
                  key={i}
                  aria-hidden
                  className="absolute inset-x-0 border-t border-dashed border-border-soft"
                  style={{ top: `${i * 25}%` }}
                />
              ))}
              <Bone className="absolute inset-x-0 bottom-0 h-2/5 opacity-60" />
            </div>
          </section>
        </div>

        {/* Tech sheet */}
        <aside className="border-b border-border px-4 py-5 lg:col-start-1 lg:row-start-1 lg:border-e lg:border-b-0">
          <h2 className={SECTION_TITLE}>{t('techTitle')}</h2>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
            {['developer', 'publisher', 'release', 'platformColumn', 'genres'].map(
              (key, i) => (
                <div key={key} className="contents">
                  <span className="font-mono text-[0.64rem] tracking-wider text-muted-foreground uppercase">
                    {t(key)}
                  </span>
                  <Bone className={`h-3.5 ${i % 2 ? 'w-20' : 'w-28'}`} />
                </div>
              ),
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

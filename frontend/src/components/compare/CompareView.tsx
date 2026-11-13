'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useFormatter, useTranslations } from 'next-intl';
import { ArrowLeftRight, Link2 } from 'lucide-react';
import type { CompareGame, PickerGame } from '@/lib/compare';
import { trackEvent } from '@/lib/analytics';
import { Link } from '@/i18n/navigation';
import { CompareChart } from './CompareChart';
import { CompareTable } from './CompareTable';
import { GamePicker } from './GamePicker';

/** Left game in the site accent, right game in the first neutral chart colour. */
const COLORS = ['var(--primary)', 'var(--chart-1)'] as const;

function SalesFigure({ game, color }: { game: CompareGame; color: string }) {
  const t = useTranslations('compare');
  const tCommon = useTranslations('common');
  const format = useFormatter();

  if (game.salesState === 'estimate' && game.sales) {
    const compact = (n: number) =>
      format.number(n, { notation: 'compact', maximumFractionDigits: 1 });
    const range = `${compact(game.sales.low)} – ${compact(game.sales.high)}`;
    return (
      <>
        <p
          className="font-mono text-3xl leading-none font-bold tabular-nums sm:text-4xl"
          style={{ color }}
        >
          {format.number(game.sales.units)}
        </p>
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          {game.sales.asOf
            ? t('salesMeta', {
                range,
                date: format.dateTime(new Date(game.sales.asOf), {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  timeZone: 'UTC',
                }),
              })
            : t('salesMetaNoDate', { range })}
        </p>
      </>
    );
  }
  const label =
    game.salesState === 'free'
      ? tCommon('freeToPlay')
      : game.salesState === 'upcoming'
        ? tCommon('upcoming')
        : game.salesState === 'pending'
          ? t('pending')
          : t('notEstimated');
  return (
    <p
      className={`font-mono text-xl font-bold ${
        game.salesState === 'free' ? 'text-source-official' : 'text-muted-foreground'
      }`}
    >
      {label}
    </p>
  );
}

function GameCard({
  game,
  color,
  onChange,
}: {
  game: CompareGame;
  color: string;
  onChange: () => void;
}) {
  const t = useTranslations('compare');
  const tGame = useTranslations('gamePage');
  const tPlatform = useTranslations('platform');
  const format = useFormatter();
  const released = game.releaseDate
    ? tGame(game.ageMonths == null ? 'releasesOn' : 'releasedOn', {
        date: format.dateTime(new Date(game.releaseDate), {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        }),
      })
    : null;

  return (
    <article
      className="flex min-w-0 flex-[1_1_340px] flex-col gap-4 rounded-[3px] border border-border bg-card p-4 sm:p-5"
      style={{ borderTop: `3px solid ${color}` }}
    >
      <div className="flex items-start gap-3">
        <div className="relative size-14 shrink-0 overflow-hidden rounded-[3px] bg-muted">
          {game.coverUrl && (
            <Image src={game.coverUrl} alt="" fill sizes="56px" className="object-cover" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={`/game/${game.slug}`}
            className="text-lg leading-tight font-semibold text-foreground hover:text-primary"
          >
            {game.name}
          </Link>
          <p className="mt-1 text-sm text-muted-foreground">
            {[game.developer, released].filter(Boolean).join(' · ')}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {game.platforms.map((p) => (
              <span
                key={p}
                className="border border-primary/40 bg-accent px-1.5 py-0.5 font-mono text-[0.68rem] text-primary"
              >
                {tPlatform(p)}
              </span>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={onChange}
          aria-label={t('changeLabel', { name: game.name })}
          className="h-9 shrink-0 rounded-[3px] border border-border px-3 font-mono text-xs text-primary hover:bg-accent"
        >
          {t('change')}
        </button>
      </div>
      <div className="border-t border-border-soft pt-3">
        <p className="mb-1 font-mono text-[0.68rem] font-semibold tracking-widest text-muted-foreground uppercase">
          {t('salesLabel')}
        </p>
        <SalesFigure game={game} color={color} />
      </div>
    </article>
  );
}

export function CompareView({
  games,
  suggestions,
}: {
  games: readonly [CompareGame, CompareGame];
  /** Picker suggestions, keyed by the slug of the game being replaced. */
  suggestions: Record<string, PickerGame[]>;
}) {
  const t = useTranslations('compare');
  const [swapped, setSwapped] = useState(false);
  const [copied, setCopied] = useState(false);
  const [replacing, setReplacing] = useState<0 | 1 | null>(null);

  const shown = (swapped ? [games[1], games[0]] : [games[0], games[1]]) as [
    CompareGame,
    CompareGame,
  ];
  const kept = replacing == null ? null : shown[replacing === 0 ? 1 : 0];
  const replaced = replacing == null ? null : shown[replacing];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      trackEvent('link_copy', { page: 'compare' });
    } catch {
      /* clipboard refused: the address bar still has the link */
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-4 pt-5 pb-4">
        <div className="min-w-0 flex-[1_1_480px]">
          <h1 className="text-2xl leading-tight font-bold tracking-tight">
            {t('heading', { a: shown[0].name, b: shown[1].name })}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-10 items-center gap-2 rounded-[3px] border border-border px-3.5 font-mono text-xs text-primary hover:bg-accent"
        >
          <Link2 aria-hidden className="size-4" />
          {copied ? t('linkCopied') : t('copyLink')}
        </button>
      </div>

      <section
        aria-label={t('gamesLabel')}
        className="flex flex-wrap items-stretch gap-3 border-b border-border px-4 pb-5"
      >
        <GameCard game={shown[0]} color={COLORS[0]} onChange={() => setReplacing(0)} />
        <div className="mx-auto flex flex-[0_0_44px] items-center justify-center">
          <button
            type="button"
            onClick={() => setSwapped((s) => !s)}
            aria-label={t('swap')}
            className="flex size-11 items-center justify-center rounded-full border border-border bg-card text-foreground hover:border-primary/60 hover:text-primary"
          >
            <ArrowLeftRight aria-hidden className="size-4" />
          </button>
        </div>
        <GameCard game={shown[1]} color={COLORS[1]} onChange={() => setReplacing(1)} />
      </section>

      <CompareChart games={shown} colors={COLORS} />
      <CompareTable games={shown} colors={COLORS} />

      {kept && replaced && (
        <GamePicker
          base={{ slug: kept.slug, name: kept.name }}
          replacing={replaced.slug}
          suggestions={suggestions[replaced.slug] ?? []}
          from="compare_page"
          onClose={() => setReplacing(null)}
        />
      )}
    </>
  );
}

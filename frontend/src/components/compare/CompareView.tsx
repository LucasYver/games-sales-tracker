'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useFormatter, useTranslations } from 'next-intl';
import { ArrowLeftRight, Link2, Plus, X } from 'lucide-react';
import {
  MAX_COMPARED,
  compareHref,
  type CompareGame,
  type PickerGame,
} from '@/lib/compare';
import { trackEvent } from '@/lib/analytics';
import { Link } from '@/i18n/navigation';
import { CompareChart } from './CompareChart';
import { CompareTable } from './CompareTable';
import { GamePicker } from './GamePicker';

/**
 * One colour per position: the site accent, the first neutral chart colour,
 * then the blue of the palette for a third game.
 */
const COLORS = ['var(--primary)', 'var(--chart-1)', 'var(--source-media)'] as const;

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
  removeHref,
}: {
  game: CompareGame;
  color: string;
  onChange: () => void;
  /** Comparison without this game; only offered when three are compared. */
  removeHref: string | null;
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
      className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 rounded-[3px] border border-border bg-card p-4 sm:p-5"
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
        <div className="flex shrink-0 flex-col items-stretch gap-1.5">
          <button
            type="button"
            onClick={onChange}
            aria-label={t('changeLabel', { name: game.name })}
            className="h-9 rounded-[3px] border border-border px-3 font-mono text-xs text-primary hover:bg-accent"
          >
            {t('change')}
          </button>
          {removeHref && (
            <Link
              href={removeHref}
              onClick={() => trackEvent('compare_option', { option: 'remove', value: game.slug })}
              aria-label={t('removeLabel', { name: game.name })}
              className="inline-flex h-9 items-center gap-1.5 rounded-[3px] border border-border px-3 font-mono text-xs text-foreground hover:border-destructive/60 hover:bg-destructive/10 hover:text-destructive"
            >
              <X aria-hidden className="size-3.5" />
              {t('removeGame')}
            </Link>
          )}
        </div>
      </div>
      {/* Pinned to the bottom, so the figures line up across the cards. */}
      <div className="mt-auto border-t border-border-soft pt-3">
        <p className="mb-1 font-mono text-[0.68rem] font-semibold tracking-widest text-muted-foreground uppercase">
          {t('salesLabel')}
        </p>
        <SalesFigure game={game} color={color} />
      </div>
    </article>
  );
}

/** Which picker is open: replacing the game at an index, or adding one. */
type Picker = { mode: 'replace'; index: number } | { mode: 'add' } | null;

export function CompareView({
  games,
  suggestions,
}: {
  /** Two or three games, in URL order. */
  games: CompareGame[];
  /** Games related to any of them, for the picker. */
  suggestions: PickerGame[];
}) {
  const t = useTranslations('compare');
  const [swapped, setSwapped] = useState(false);
  const [copied, setCopied] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);

  // Swapping only means something with two games.
  const shown = games.length === 2 && swapped ? [games[1], games[0]] : games;
  const colors = shown.map((_, i) => COLORS[i]);
  const canAdd = shown.length < MAX_COMPARED;
  const kept =
    picker == null
      ? []
      : picker.mode === 'add'
        ? shown
        : shown.filter((_, i) => i !== picker.index);
  const replacing = picker?.mode === 'replace' ? shown[picker.index].slug : undefined;

  const [a, b, c] = shown.map((g) => g.name);
  const title = shown.length === 3 ? t('heading3', { a, b, c }) : t('heading', { a, b });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      trackEvent('link_copy', { page: 'compare' });
    } catch {
      /* clipboard refused: the address bar still has the link */
    }
  };

  const card = (game: CompareGame, i: number) => (
    <GameCard
      key={game.slug}
      game={game}
      color={colors[i]}
      onChange={() => setPicker({ mode: 'replace', index: i })}
      removeHref={
        shown.length > 2
          ? compareHref(...shown.filter((g) => g.slug !== game.slug).map((g) => g.slug))
          : null
      }
    />
  );

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-4 pt-5 pb-4">
        <div className="min-w-0 flex-[1_1_480px]">
          <h1 className="text-2xl leading-tight font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {shown.length === 3 ? t('intro3') : t('intro')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canAdd && (
            <button
              type="button"
              onClick={() => setPicker({ mode: 'add' })}
              aria-haspopup="dialog"
              className="inline-flex h-10 items-center gap-2 rounded-[3px] border border-primary/50 px-3.5 font-mono text-xs font-semibold text-primary hover:bg-accent"
            >
              <Plus aria-hidden className="size-4" />
              {t('addGame')}
            </button>
          )}
          <button
            type="button"
            onClick={copy}
            className="inline-flex h-10 items-center gap-2 rounded-[3px] border border-border px-3.5 font-mono text-xs text-primary hover:bg-accent"
          >
            <Link2 aria-hidden className="size-4" />
            {copied ? t('linkCopied') : t('copyLink')}
          </button>
        </div>
      </div>

      <section
        aria-label={t('gamesLabel')}
        className="flex flex-wrap items-stretch gap-3 border-b border-border px-4 pb-5"
      >
        {shown.length === 2 ? (
          <>
            {card(shown[0], 0)}
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
            {card(shown[1], 1)}
          </>
        ) : (
          shown.map(card)
        )}
      </section>

      <CompareChart games={shown} colors={colors} />
      <CompareTable games={shown} colors={colors} />

      {picker && (
        <GamePicker
          keep={kept.map((g) => ({ slug: g.slug, name: g.name }))}
          replacing={replacing}
          suggestions={suggestions}
          from={picker.mode === 'add' ? 'compare_add' : 'compare_change'}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );
}

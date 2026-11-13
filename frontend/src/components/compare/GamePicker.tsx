'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Image from 'next/image';
import { useFormatter, useTranslations } from 'next-intl';
import { Search, X } from 'lucide-react';
import { API_URL, isUpcoming, listingUnits, type PopularGame } from '@/lib/api';
import { compareHref, type PickerGame } from '@/lib/compare';
import { trackEvent } from '@/lib/analytics';
import { Link } from '@/i18n/navigation';

const MIN_QUERY = 2;
const DEBOUNCE_MS = 180;
const RESULT_LIMIT = 8;

/**
 * Chooses the game to compare with `base`. Opens on suggestions from the same
 * franchise and studio; typing searches the whole catalog like the header
 * search. Each row is a real link to the comparison page.
 */
export function GamePicker({
  base,
  replacing,
  suggestions,
  from,
  onClose,
}: {
  /** The game that stays in the comparison. */
  base: { slug: string; name: string };
  /** The game being replaced, when the picker opens from a comparison. */
  replacing?: string;
  suggestions: PickerGame[];
  /** Where the picker was opened, for analytics. */
  from: string;
  onClose: () => void;
}) {
  const t = useTranslations('compare');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const titleId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [results, setResults] = useState<PopularGame[]>([]);
  const [resultsQuery, setResultsQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const query = value.trim();

  useEffect(() => {
    if (query.length < MIN_QUERY) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(
        `${API_URL}/games/search?q=${encodeURIComponent(query)}&limit=${RESULT_LIMIT}`,
        { signal: controller.signal },
      )
        .then((res) => (res.ok ? res.json() : []))
        .then((games: PopularGame[]) => {
          setResults(games);
          setResultsQuery(query);
        })
        .catch(() => {
          /* aborted or offline: keep what is on screen */
        })
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  // The latest onClose, so the effect below runs once per opening.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // The dialog owns the viewport: focus its field, freeze the page behind,
  // and close on Escape wherever the focus is.
  useEffect(() => {
    inputRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const searching = query.length >= MIN_QUERY;
  const rows: PickerGame[] = (searching ? results : suggestions).filter(
    (g) => g.slug !== base.slug,
  );

  const estimate = (game: PickerGame) => {
    if (game.isFree) return { text: tCommon('freeToPlay'), muted: false };
    if (isUpcoming(game.releaseDate)) return { text: tCommon('upcoming'), muted: true };
    const units = listingUnits(game);
    return units
      ? {
          text: t('estimateShort', {
            units: format.number(units, { notation: 'compact', maximumFractionDigits: 1 }),
          }),
          muted: false,
        }
      : { text: t('notEstimated'), muted: true };
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/80 px-4 pt-16 pb-4 backdrop-blur-[2px] sm:pt-24"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-[3px] border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border-soft py-2 pe-2 ps-4">
          <h2 id={titleId} className="text-[0.95rem] font-semibold text-foreground">
            {t('pickerTitle', { name: base.name })}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('pickerClose')}
            className="flex size-10 items-center justify-center rounded-[3px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-1.5 px-4 py-3">
          <label
            htmlFor={inputId}
            className="font-mono text-[0.68rem] font-semibold tracking-widest text-muted-foreground uppercase"
          >
            {t('pickerLabel')}
          </label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 start-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              ref={inputRef}
              id={inputId}
              type="search"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t('pickerPlaceholder')}
              className="h-10 w-full rounded-[3px] border border-border bg-background pe-8 ps-8 font-mono text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:outline-none"
            />
            {loading && (
              <span
                aria-hidden
                className="absolute top-1/2 end-2.5 size-3 -translate-y-1/2 animate-pulse rounded-full bg-primary"
              />
            )}
          </div>
        </div>

        {!searching && rows.length > 0 && (
          <p className="px-4 pb-1 font-mono text-[0.66rem] tracking-wider text-text-faint uppercase">
            {t('pickerSuggestions')}
          </p>
        )}

        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
          {rows.map((game) => {
            const est = estimate(game);
            const year = game.releaseDate?.slice(0, 4);
            const meta = [
              game.reason === 'franchise'
                ? t('pickerSameFranchise')
                : game.reason === 'studio'
                  ? t('pickerSameStudio')
                  : null,
              year,
              game.slug === replacing ? t('pickerShownHere') : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <li key={game.slug}>
                <Link
                  href={compareHref(base.slug, game.slug)}
                  prefetch={false}
                  onClick={(e) => {
                    if (game.slug === replacing) {
                      e.preventDefault();
                      onClose();
                      return;
                    }
                    trackEvent('compare_pick', { from, game: game.slug });
                  }}
                  className="flex items-center gap-3 rounded-[3px] px-2 py-2 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  <span className="relative size-9 shrink-0 overflow-hidden rounded-[3px] bg-muted">
                    {game.coverUrl && (
                      <Image src={game.coverUrl} alt="" fill sizes="36px" className="object-cover" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {game.name}
                    </span>
                    {meta && (
                      <span className="block font-mono text-xs text-muted-foreground">
                        {meta}
                      </span>
                    )}
                  </span>
                  <span
                    className={`shrink-0 font-mono text-[0.8rem] font-semibold tabular-nums ${
                      est.muted ? 'text-muted-foreground' : 'text-primary'
                    }`}
                  >
                    {est.text}
                  </span>
                </Link>
              </li>
            );
          })}
          {searching && resultsQuery === query && !loading && rows.length === 0 && (
            <li className="px-2 py-6 text-center text-sm text-muted-foreground">
              {t('pickerNoResult', { query })}
            </li>
          )}
        </ul>

        <p className="border-t border-border-soft px-4 py-2.5 text-xs text-muted-foreground">
          {t('pickerHint')}
        </p>
      </div>
    </div>
  );
}

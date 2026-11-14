'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Image from 'next/image';
import { useFormatter, useTranslations } from 'next-intl';
import { Search, X } from 'lucide-react';
import { API_URL, isUpcoming, listingUnits, type PopularGame } from '@/lib/api';
import { compareHref, type PickerGame } from '@/lib/compare';
import { trackEvent } from '@/lib/analytics';
import { Link, useRouter } from '@/i18n/navigation';

const MIN_QUERY = 2;
const DEBOUNCE_MS = 180;
const RESULT_LIMIT = 8;

/**
 * Chooses a game to compare with the `keep` games. Opens on suggestions from the same
 * franchise and studio; typing searches the whole catalog like the header
 * search. Each row is a real link to the comparison page; ↑ ↓ move through
 * the rows and Enter opens the highlighted one (or the first).
 */
export function GamePicker({
  keep,
  replacing,
  suggestions,
  from,
  onClose,
}: {
  /** The games that stay in the comparison (one or two). */
  keep: { slug: string; name: string }[];
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
  const listId = useId();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  // Highlighted row for the keyboard; -1 = none.
  const [active, setActive] = useState(-1);
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
  const kept = new Set(keep.map((g) => g.slug));
  const rows: PickerGame[] = (searching ? results : suggestions).filter(
    (g) => !kept.has(g.slug),
  );
  const current = active >= 0 && active < rows.length ? active : -1;
  const optionId = (i: number) => `${listId}-option-${i}`;

  // Keep the highlighted row visible when the arrows move past the edge.
  useEffect(() => {
    if (current >= 0) document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const choose = (game: PickerGame) => {
    if (game.slug === replacing) {
      onClose();
      return;
    }
    trackEvent('compare_pick', { from, game: game.slug });
    router.push(compareHref(...kept, game.slug));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (rows.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current + 1) % rows.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(current <= 0 ? rows.length - 1 : current - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(rows[current >= 0 ? current : 0]);
    }
  };

  const title =
    keep.length === 1
      ? t('pickerTitle', { name: keep[0].name })
      : t('pickerTitleTwo', { a: keep[0].name, b: keep[1].name });

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
        <h2
          id={titleId}
          className="border-b border-border-soft px-4 py-3 text-[0.95rem] font-semibold text-foreground"
        >
          {title}
        </h2>

        <div className="flex flex-col gap-1.5 px-4 py-3">
          <label
            htmlFor={inputId}
            className="font-mono text-[0.68rem] font-semibold tracking-widest text-muted-foreground uppercase"
          >
            {t('pickerLabel')}
          </label>
          {/* Like the header search: the field, then a close button outside it
              (no clear cross inside the field). */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 start-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                ref={inputRef}
                id={inputId}
                type="search"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setActive(-1);
                }}
                onKeyDown={onKeyDown}
                role="combobox"
                aria-expanded={rows.length > 0}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={current >= 0 ? optionId(current) : undefined}
                placeholder={t('pickerPlaceholder')}
                className="h-10 w-full rounded-[3px] border border-border bg-background pe-8 ps-8 font-mono text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:outline-none [&::-webkit-search-cancel-button]:appearance-none"
              />
              {loading && (
                <span
                  aria-hidden
                  className="absolute top-1/2 end-2.5 size-3 -translate-y-1/2 animate-pulse rounded-full bg-primary"
                />
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('pickerClose')}
              className="flex size-10 shrink-0 items-center justify-center rounded-[3px] border border-border text-muted-foreground hover:text-foreground"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        </div>

        {!searching && rows.length > 0 && (
          <p className="px-4 pb-1 font-mono text-[0.66rem] tracking-wider text-text-faint uppercase">
            {t('pickerSuggestions')}
          </p>
        )}

        <ul
          id={listId}
          role="listbox"
          aria-labelledby={titleId}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2"
        >
          {rows.map((game, idx) => {
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
              <li key={game.slug} id={optionId(idx)} role="option" aria-selected={idx === current}>
                <Link
                  href={compareHref(...kept, game.slug)}
                  prefetch={false}
                  tabIndex={-1}
                  onMouseEnter={() => setActive(idx)}
                  onClick={(e) => {
                    if (game.slug === replacing) {
                      e.preventDefault();
                      onClose();
                      return;
                    }
                    trackEvent('compare_pick', { from, game: game.slug });
                  }}
                  className={`flex items-center gap-3 rounded-[3px] px-2 py-2 focus-visible:outline-none ${
                    idx === current ? 'bg-accent' : ''
                  }`}
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

'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { Search, X } from 'lucide-react';
import {
  API_URL,
  isUpcoming,
  listingUnits,
  type PopularGame,
} from '@/lib/api';
import { Link, useRouter } from '@/i18n/navigation';
import { trackEvent } from '@/lib/analytics';
import {
  GamePageSkeleton,
  type GamePreview,
} from '@/components/GamePageSkeleton';

const MIN_QUERY = 2;
const DEBOUNCE_MS = 180;
const RESULT_LIMIT = 20;
/** How long an empty result must stay on screen before it counts as a miss,
 *  so half-typed queries ("zel" on the way to "zelda") are not reported. */
const NO_RESULT_DELAY_MS = 1500;

/**
 * Live search. Focusing the field opens a full-page panel and results stream
 * in as you type — cover, year, platforms, genres, reviews and the sales
 * figure, so the right game is identifiable without opening it. Enter on a
 * highlighted row opens that game; Enter with nothing highlighted falls back
 * to the regular results page, so the panel is never the only way through.
 */
export function SearchBar() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslations('searchBar');
  const tPlatform = useTranslations('platform');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const listId = useId();

  const [value, setValue] = useState(params.get('q') ?? '');
  const [results, setResults] = useState<PopularGame[]>([]);
  // The query the current results answer, so an empty list is only reported
  // once it belongs to what is typed now.
  const [resultsQuery, setResultsQuery] = useState('');
  const reportedMisses = useRef(new Set<string>());
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const panelInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  // A game page renders on the server and has no loading.tsx (see
  // GamePageSkeleton), so the old page would sit there untouched until the
  // new one lands. While that navigation is pending, a skeleton covers
  // everything below the site header.
  const [navigating, startNavigation] = useTransition();
  const [skeletonTop, setSkeletonTop] = useState(0);
  const [preview, setPreview] = useState<GamePreview>();

  const query = value.trim();

  useEffect(() => {
    // A too-short query shows nothing, but that is derived below rather than
    // written to state here.
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
          setActive(-1);
        })
        .catch(() => {
          /* aborted or offline: keep whatever is on screen */
        })
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  // A query that settles on no result points at a game missing from the
  // catalog: report it once per session.
  useEffect(() => {
    if (query.length < MIN_QUERY || resultsQuery !== query) return;
    if (results.length > 0) return;
    const key = query.toLowerCase();
    if (reportedMisses.current.has(key)) return;
    const timer = setTimeout(() => {
      reportedMisses.current.add(key);
      trackEvent('search_no_result', { query: key.slice(0, 50) });
    }, NO_RESULT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, results, resultsQuery]);

  // The panel owns the viewport while open: focus its field, and stop the page
  // behind it from scrolling.
  useEffect(() => {
    if (!open) return;
    panelInputRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Results always belong to a query at least MIN_QUERY long; while a new
  // query is in flight the previous hits stay up rather than flashing empty.
  const visible = query.length >= MIN_QUERY ? results : [];

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  const trackResult = (game: PopularGame, position: number) =>
    trackEvent('search_result_click', { game: game.slug, position: position + 1 });

  // Same-tab opening only: a Cmd/Ctrl/Shift or middle click is left to the
  // browser, which opens the link elsewhere and keeps the panel up so several
  // games can be opened from one search.
  const openGame = (game: PopularGame) => {
    close();
    const header = triggerRef.current?.closest('header');
    setSkeletonTop(Math.max(0, header?.getBoundingClientRect().bottom ?? 0));
    setPreview({
      name: game.name,
      coverUrl: game.coverUrl,
      platforms: game.platforms,
    });
    startNavigation(() => router.push(`/game/${game.slug}`));
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (active >= 0 && visible[active]) {
      trackResult(visible[active], active);
      openGame(visible[active]);
      return;
    }
    close();
    router.push(query ? `/?q=${encodeURIComponent(query)}` : '/');
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (visible.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (i + 1) % visible.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (i <= 0 ? visible.length - 1 : i - 1));
    }
  };

  const fieldClass =
    'h-9 w-full border border-border bg-background px-8 font-mono text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:outline-none';

  return (
    <>
      {/* Header trigger: a real input, so the first keystroke lands in the
          query instead of being swallowed by opening the panel. */}
      <div ref={triggerRef} className="relative w-full">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 start-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={t('placeholder')}
          aria-label={t('placeholder')}
          className={fieldClass}
        />
      </div>

      {navigating && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 overflow-hidden bg-background"
          style={{ top: skeletonTop }}
        >
          <GamePageSkeleton preview={preview} />
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-background"
          role="dialog"
          aria-modal="true"
          aria-label={t('resultsLabel')}
        >
          <div className="border-b border-border bg-card">
            <form
              onSubmit={submit}
              role="search"
              className="mx-auto flex w-full max-w-4xl items-center gap-2 px-4 py-3"
            >
              <div className="relative flex-1">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 start-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  ref={panelInputRef}
                  type="search"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={t('placeholder')}
                  aria-label={t('placeholder')}
                  role="combobox"
                  aria-expanded
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={
                    active >= 0 ? `${listId}-option-${active}` : undefined
                  }
                  className={fieldClass}
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
                onClick={close}
                aria-label={t('close')}
                className="border border-border p-1.5 text-muted-foreground hover:text-foreground"
              >
                <X aria-hidden className="size-4" />
              </button>
            </form>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto w-full max-w-4xl px-4 py-4">
              {query.length < MIN_QUERY ? (
                <p className="px-2 py-10 text-center text-sm text-muted-foreground">
                  {t('hint', { count: MIN_QUERY })}
                </p>
              ) : visible.length === 0 ? (
                <p className="px-2 py-10 text-center text-sm text-muted-foreground">
                  {loading ? t('searching') : t('empty')}
                </p>
              ) : (
                <>
                  <p className="mb-2 px-2 font-mono text-[0.66rem] tracking-wider text-text-faint uppercase">
                    {t('resultsCount', { count: visible.length })}
                  </p>
                  <ul id={listId} role="listbox" aria-label={t('resultsLabel')}>
                    {visible.map((game, idx) => {
                      const units = listingUnits(game);
                      const year = game.releaseDate
                        ? new Date(game.releaseDate).getFullYear()
                        : null;
                      const meta = [
                        year,
                        game.platforms.map((p) => tPlatform(p)).join('/'),
                        game.genres.slice(0, 2).join(', '),
                      ]
                        .filter(Boolean)
                        .join(' · ');

                      return (
                        <li
                          key={game.id}
                          id={`${listId}-option-${idx}`}
                          role="option"
                          aria-selected={idx === active}
                        >
                          {/* A real link, so Cmd/Ctrl/middle click opens the
                              game in a new tab. No prefetch: twenty results
                              per keystroke would each hit the server. */}
                          <Link
                            href={`/game/${game.slug}`}
                            prefetch={false}
                            onMouseEnter={() => setActive(idx)}
                            onClick={() => trackResult(game, idx)}
                            onAuxClick={(e) => {
                              if (e.button === 1) trackResult(game, idx);
                            }}
                            onNavigate={(e) => {
                              e.preventDefault();
                              openGame(game);
                            }}
                            className={`flex w-full items-center gap-3 border-b border-border-soft px-2 py-2.5 text-start ${
                              idx === active ? 'bg-accent' : ''
                            }`}
                          >
                            <span className="relative h-[30px] w-16 shrink-0 overflow-hidden bg-muted sm:h-[43px] sm:w-[92px]">
                              {game.coverUrl && (
                                <Image
                                  src={game.coverUrl}
                                  alt=""
                                  fill
                                  sizes="92px"
                                  className="object-cover"
                                />
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-semibold text-foreground">
                                {game.name}
                              </span>
                              <span className="block truncate font-mono text-[0.7rem] text-muted-foreground">
                                {meta}
                              </span>
                            </span>
                            <span className="hidden shrink-0 text-end font-mono text-xs text-muted-foreground tabular-nums sm:block">
                              {game.reviews > 0
                                ? t('reviewsCount', {
                                    count: format.number(game.reviews, {
                                      notation: 'compact',
                                    }),
                                  })
                                : ''}
                            </span>
                            <span className="w-20 shrink-0 text-end font-mono text-sm font-semibold tabular-nums">
                              {game.isFree ? (
                                <span className="text-source-official">
                                  {tCommon('freeToPlay')}
                                </span>
                              ) : units ? (
                                format.number(units, {
                                  notation: 'compact',
                                  maximumFractionDigits: 1,
                                })
                              ) : isUpcoming(game.releaseDate) ? (
                                <span className="text-muted-foreground">
                                  {tCommon('upcoming')}
                                </span>
                              ) : (
                                <span className="text-text-faint">—</span>
                              )}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-3 px-2 font-mono text-[0.66rem] text-text-faint">
                    {t('keyboardHint')}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

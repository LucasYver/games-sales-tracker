'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { Search, X } from 'lucide-react';
import { API_URL, listingUnits, type PopularGame } from '@/lib/api';
import { useRouter } from '@/i18n/navigation';

const MIN_QUERY = 2;
const DEBOUNCE_MS = 180;
const RESULT_LIMIT = 20;

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
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const panelInputRef = useRef<HTMLInputElement>(null);

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

  const goToGame = (game: PopularGame) => {
    close();
    router.push(`/game/${game.slug}`);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (active >= 0 && visible[active]) {
      goToGame(visible[active]);
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
      <div className="relative w-full">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
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
                  className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
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
                    className="absolute top-1/2 right-2.5 size-3 -translate-y-1/2 animate-pulse rounded-full bg-primary"
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
                          <button
                            type="button"
                            onMouseEnter={() => setActive(idx)}
                            onClick={() => goToGame(game)}
                            className={`flex w-full items-center gap-3 border-b border-border-soft px-2 py-2.5 text-left ${
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
                            <span className="hidden shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums sm:block">
                              {game.reviews > 0
                                ? t('reviewsCount', {
                                    count: format.number(game.reviews, {
                                      notation: 'compact',
                                    }),
                                  })
                                : ''}
                            </span>
                            <span className="w-20 shrink-0 text-right font-mono text-sm font-semibold tabular-nums">
                              {game.isFree ? (
                                <span className="text-source-official">
                                  {tCommon('freeToPlay')}
                                </span>
                              ) : units ? (
                                format.number(units, {
                                  notation: 'compact',
                                  maximumFractionDigits: 1,
                                })
                              ) : (
                                <span className="text-text-faint">—</span>
                              )}
                            </span>
                          </button>
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

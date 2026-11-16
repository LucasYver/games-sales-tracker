'use client';

import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { Building2, Search, X } from 'lucide-react';
import {
  API_URL,
  isUpcoming,
  listingUnits,
  type PopularGame,
  type SearchCompany,
} from '@/lib/api';
import { Link, useRouter } from '@/i18n/navigation';
import { trackEvent } from '@/lib/analytics';
import { fold } from '@/lib/fold';
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
/** Studios and publishers listed under the games. */
const COMPANY_LIMIT = 6;

const companyPath = (company: SearchCompany) =>
  `/${company.kind}/${company.slug}`;

type Row =
  | { kind: 'game'; game: PopularGame }
  | { kind: 'company'; company: SearchCompany };

const ROMAN: Record<string, string> = {
  i: '1',
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
};

/**
 * Whether a game title really answers the query rather than resembling it:
 * a word of the title starts with it ("capcom" in Marvel vs. Capcom), or it
 * starts the title's acronym the way the backend reads one ("gta6", "cod",
 * "rdr2": first letters, numbers whole, a Roman numeral after the first word
 * as itself or as digits, the part after a colon on its own too).
 */
function closeGameMatch(name: string, query: string): boolean {
  const q = fold(query);
  if (!q) return false;
  if (` ${fold(name)}`.includes(` ${q}`)) return true;
  const compact = q.replace(/ /g, '');
  if (compact.length < 3) return false;
  const colon = name.indexOf(':');
  const segments = colon >= 0 ? [name, name.slice(colon + 1)] : [name];
  return segments.some((segment) => {
    const words = fold(segment.replace(/['’]/g, '')).split(' ').filter(Boolean);
    const part = (word: string, i: number, digits: boolean) =>
      /^\d+$/.test(word)
        ? word
        : i > 0 && ROMAN[word]
          ? digits
            ? ROMAN[word]
            : word
          : word[0];
    return [true, false].some((digits) =>
      words
        .map((w, i) => part(w, i, digits))
        .join('')
        .startsWith(compact),
    );
  });
}

/**
 * Studios and publishers whose name has a word starting with the query
 * ("namco" finds Bandai Namco, "soft" does not find Microsoft): a plain
 * substring match turns two letters into dozens of unrelated names. Exact
 * names first, then names that start with the query, then the biggest.
 */
function matchCompanies(
  companies: SearchCompany[],
  query: string,
): SearchCompany[] {
  const q = fold(query);
  if (!q) return [];
  const rank = (name: string) =>
    name === q
      ? 0
      : name.startsWith(q)
        ? 1
        : ` ${name}`.includes(` ${q}`)
          ? 2
          : -1;
  return companies
    .map((company) => ({ company, rank: rank(fold(company.name)) }))
    .filter((hit) => hit.rank >= 0)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        b.company.games - a.company.games ||
        a.company.name.localeCompare(b.company.name),
    )
    .slice(0, COMPANY_LIMIT)
    .map((hit) => hit.company);
}

/**
 * Live search. Focusing the field opens a full-page panel and results stream
 * in as you type — cover, year, platforms, genres, reviews and the sales
 * figure, so the right game is identifiable without opening it. Studios and
 * publishers with a hub page follow the games, matched in the browser
 * against a list loaded once per visit. Enter on a highlighted row opens that
 * game or hub; Enter with nothing highlighted falls back to the regular
 * results page, so the panel is never the only way through.
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
  // Studios and publishers, fetched the first time the panel opens; null
  // until then.
  const [companies, setCompanies] = useState<SearchCompany[] | null>(null);
  const companiesRequested = useRef(false);

  const query = value.trim();

  useEffect(() => {
    if (!open || companiesRequested.current) return;
    companiesRequested.current = true;
    fetch('/search-companies.json')
      .then((res) => (res.ok ? res.json() : []))
      .then((list: SearchCompany[]) => setCompanies(list))
      .catch(() => setCompanies([]));
  }, [open]);

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

  // Results always belong to a query at least MIN_QUERY long; while a new
  // query is in flight the previous hits stay up rather than flashing empty.
  const visible = useMemo(
    () => (query.length >= MIN_QUERY ? results : []),
    [query, results],
  );
  const companyHits = useMemo(
    () =>
      query.length >= MIN_QUERY && companies
        ? matchCompanies(companies, query)
        : [],
    [companies, query],
  );
  // The trigram search nearly always fills its twenty rows, so studios and
  // publishers placed after every game would sit out of sight. They come
  // after the games that really match the query and before the near misses.
  const { closeGames, looseGames } = useMemo(() => {
    const isClose = (game: PopularGame) => closeGameMatch(game.name, query);
    return {
      closeGames: visible.filter(isClose),
      looseGames: visible.filter((game) => !isClose(game)),
    };
  }, [visible, query]);
  const rows: Row[] = [
    ...closeGames.map((game) => ({ kind: 'game' as const, game })),
    ...companyHits.map((company) => ({ kind: 'company' as const, company })),
    ...looseGames.map((game) => ({ kind: 'game' as const, game })),
  ];
  const rowCount = rows.length;

  // A query that settles on no game and no studio or publisher points at
  // something missing from the catalog: report it once per session.
  useEffect(() => {
    if (query.length < MIN_QUERY || resultsQuery !== query) return;
    if (results.length > 0 || companies === null || companyHits.length > 0)
      return;
    const key = query.toLowerCase();
    if (reportedMisses.current.has(key)) return;
    const timer = setTimeout(() => {
      reportedMisses.current.add(key);
      trackEvent('search_no_result', { query: key.slice(0, 50) });
    }, NO_RESULT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, results, resultsQuery, companies, companyHits]);

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

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  /** A game row's rank among the games shown, studios and publishers aside. */
  const gamePosition = (rowIndex: number) =>
    rowIndex < closeGames.length ? rowIndex : rowIndex - companyHits.length;

  const trackResult = (game: PopularGame, position: number) =>
    trackEvent('search_result_click', {
      game: game.slug,
      position: position + 1,
    });

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

  const trackCompany = (company: SearchCompany) =>
    trackEvent('search_hub_click', { hub: company.kind, slug: company.slug });

  const openCompany = (company: SearchCompany) => {
    close();
    router.push(companyPath(company));
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const row = active >= 0 ? rows[active] : undefined;
    if (row?.kind === 'game') {
      trackResult(row.game, gamePosition(active));
      openGame(row.game);
      return;
    }
    if (row?.kind === 'company') {
      trackCompany(row.company);
      openCompany(row.company);
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
    // One run through games then studios and publishers.
    if (rowCount === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (i + 1) % rowCount);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (i <= 0 ? rowCount - 1 : i - 1));
    }
  };

  /** The section title shown above a row, if a section starts there. */
  const headingBefore = (idx: number): string | null => {
    if (idx === 0 && closeGames.length > 0)
      return t('resultsCount', { count: visible.length });
    if (idx === closeGames.length && companyHits.length > 0)
      return t('companiesHeading');
    if (idx === closeGames.length + companyHits.length && looseGames.length > 0)
      return closeGames.length > 0 && companyHits.length > 0
        ? t('moreGames')
        : t('resultsCount', { count: visible.length });
    return null;
  };

  const renderCompany = (company: SearchCompany, idx: number) => (
    <li
      id={`${listId}-option-${idx}`}
      role="option"
      aria-selected={idx === active}
    >
      <Link
        href={companyPath(company)}
        prefetch={false}
        onMouseEnter={() => setActive(idx)}
        onClick={() => trackCompany(company)}
        onAuxClick={(e) => {
          if (e.button === 1) trackCompany(company);
        }}
        onNavigate={close}
        className={`flex w-full items-center gap-3 border-b border-border-soft px-2 py-2.5 text-start ${
          idx === active ? 'bg-accent' : ''
        }`}
      >
        <span className="flex h-[30px] w-16 shrink-0 items-center justify-center bg-muted text-muted-foreground sm:h-[43px] sm:w-[92px]">
          <Building2 aria-hidden className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-foreground">
            {company.name}
          </span>
          <span className="block truncate font-mono text-[0.7rem] text-muted-foreground">
            {company.kind === 'studio' ? t('kindStudio') : t('kindPublisher')}
            {' · '}
            {t('companyGames', { count: company.games })}
          </span>
        </span>
      </Link>
    </li>
  );

  const sectionHeadingClass =
    'mb-2 px-2 font-mono text-[0.66rem] tracking-wider text-text-faint uppercase';

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
              ) : rowCount === 0 ? (
                <p className="px-2 py-10 text-center text-sm text-muted-foreground">
                  {loading ? t('searching') : t('empty')}
                </p>
              ) : (
                <>
                  <ul id={listId} role="listbox" aria-label={t('resultsLabel')}>
                    {rows.map((row, idx) => {
                      const heading = headingBefore(idx);
                      const headingRow = heading && (
                        <li
                          role="presentation"
                          className={`${sectionHeadingClass} ${idx > 0 ? 'mt-5' : ''}`}
                        >
                          {heading}
                        </li>
                      );
                      if (row.kind === 'company') {
                        return (
                          <Fragment
                            key={`${row.company.kind}-${row.company.slug}`}
                          >
                            {headingRow}
                            {renderCompany(row.company, idx)}
                          </Fragment>
                        );
                      }
                      const { game } = row;
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
                        <Fragment key={game.id}>
                          {headingRow}
                          <li
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
                              onClick={() =>
                                trackResult(game, gamePosition(idx))
                              }
                              onAuxClick={(e) => {
                                if (e.button === 1)
                                  trackResult(game, gamePosition(idx));
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
                        </Fragment>
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

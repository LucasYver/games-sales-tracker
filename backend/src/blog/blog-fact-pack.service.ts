import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Game,
  Milestone,
  Platform,
  SalesSource,
  SignalMetric,
  SignalSnapshot,
} from '../entities';
import {
  isAlineaMilestone,
  isBlogEligibleMilestone,
  sourceDisplayName,
} from './blog-alinea';
import type { BlogFact, BlogFactPack, BlogFreshness } from './blog.types';
import { publicAppUrl } from './blog.types';

const PLATFORM_NAME: Record<string, string> = {
  PC: 'PC',
  PLAYSTATION: 'PlayStation',
  XBOX: 'Xbox',
  SWITCH: 'Nintendo Switch',
  MOBILE: 'mobile',
  OTHER: 'one platform',
};

type FactFields = Omit<BlogFact, 'id'>;

type GameNames = { publisher?: string | null; developer?: string | null };

/** Generic credits from article extraction ("reportedly", "the press"...). */
const GENERIC_CREDIT =
  /^(the |a |an |une? |la |le |les )?(press|presse|media|médias|report|reports|reportedly|sources?|analysts?|sales analysis|new sales analysis|nouvelle analyse des ventes|analyse des ventes|insiders?|data|données)\b/i;
const OWN_CREDIT =
  /^(the |l'|le |la )?(publisher|developer|studio|éditeur|développeur|studio)$/i;

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(co|ltd|inc|corp|corporation|llc|sa|gmbh|kk|k\.k)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sameCompany(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

/**
 * Who a milestone is credited to, in words fit for an article, and how far
 * it can be trusted. Press credits are free text from extraction: generic
 * ones ("reportedly", "new sales analysis") become "press reports"; a
 * credit to the game's publisher or developer keeps that company's name.
 */
function attribution(
  row: Milestone,
  game: GameNames,
): { sourceName: string; sourceRank: number; creditedToMaker: boolean } {
  const credit = row.publisher?.trim() ?? '';
  const maker = [game.publisher, game.developer].find(
    (name): name is string => !!name?.trim() && sameCompany(credit, name),
  );
  const ownCredit = OWN_CREDIT.test(credit) ? game.publisher?.trim() : null;
  const makerName = maker?.trim() ?? ownCredit ?? null;

  if (isAlineaMilestone(row)) {
    return {
      sourceName: 'Alinea Analytics',
      sourceRank: 3,
      creditedToMaker: false,
    };
  }
  switch (row.source) {
    case SalesSource.OFFICIAL:
    case SalesSource.ANNOUNCEMENT:
      return {
        sourceName:
          makerName ??
          (credit && !GENERIC_CREDIT.test(credit) ? credit : null) ??
          game.publisher?.trim() ??
          sourceDisplayName(row),
        sourceRank: 0,
        creditedToMaker: true,
      };
    case SalesSource.WIKIPEDIA:
      return { sourceName: 'Wikipedia', sourceRank: 2, creditedToMaker: false };
    default:
      if (makerName) {
        return { sourceName: makerName, sourceRank: 1, creditedToMaker: true };
      }
      if (
        !credit ||
        GENERIC_CREDIT.test(credit) ||
        credit === credit.toLowerCase()
      ) {
        return {
          sourceName: 'press reports',
          sourceRank: 3,
          creditedToMaker: false,
        };
      }
      return { sourceName: credit, sourceRank: 3, creditedToMaker: false };
  }
}

/**
 * What a milestone number measures, spelled out so the writer cannot blur
 * it. Internal note for the writer: it is told never to copy the wording.
 */
function milestoneLabel(
  row: Milestone,
  sourceName: string,
  creditedToMaker: boolean,
): string {
  const scope =
    row.platform === Platform.GLOBAL
      ? 'all platforms, worldwide'
      : `${PLATFORM_NAME[row.platform] ?? row.platform} only, not the worldwide total`;
  const what = row.isEngagement
    ? `players reached, ${scope}; may include Game Pass or free access; not copies sold`
    : `total copies sold so far, ${scope}`;
  if (isAlineaMilestone(row)) {
    return `${what}; analyst ESTIMATE, not an official figure`;
  }
  switch (row.source) {
    case SalesSource.OFFICIAL:
    case SalesSource.ANNOUNCEMENT:
      return `${what}; official statement`;
    case SalesSource.WIKIPEDIA:
      return `${what}; cited on Wikipedia`;
    default:
      return creditedToMaker
        ? `${what}; figure from ${sourceName}, known through press coverage`
        : `${what}; press report`;
  }
}

/**
 * Blog-eligible milestones as facts (no ids), consolidated. Leaks and model
 * estimates stay out. `game` names the publisher/developer for credits.
 */
export function milestoneFacts(
  rows: Milestone[],
  game: GameNames = {},
): FactFields[] {
  const facts: FactFields[] = [];
  for (const row of rows) {
    if (!isBlogEligibleMilestone(row)) continue;
    const { sourceName, sourceRank, creditedToMaker } = attribution(row, game);
    facts.push({
      kind: row.isEngagement ? 'engagement' : 'sales',
      value: row.units,
      unit: row.isEngagement ? 'players' : 'copies',
      platform: row.platform,
      source: row.source,
      sourceName,
      sourceRank,
      date: row.reportedAt ? row.reportedAt.toISOString().slice(0, 10) : null,
      isEngagement: row.isEngagement,
      isAlinea: isAlineaMilestone(row),
      label: milestoneLabel(row, sourceName, creditedToMaker),
      sourceUrl: row.sourceUrl,
    });
  }
  return consolidateFacts(facts);
}

const SOURCE_RANK: Record<string, number> = {
  OFFICIAL: 0,
  ANNOUNCEMENT: 0,
  WIKIPEDIA: 2,
  MEDIA: 3,
};

export function factRank(f: Pick<FactFields, 'source' | 'sourceRank'>): number {
  return f.sourceRank ?? SOURCE_RANK[f.source] ?? 9;
}

const MS_DAY = 86_400_000;

function daysApart(a: string | null, b: string | null): number {
  if (!a || !b) return Infinity;
  return Math.abs(Date.parse(a) - Date.parse(b)) / MS_DAY;
}

function within(a: number, b: number, ratio: number): boolean {
  return Math.abs(a - b) <= Math.max(a, b) * ratio;
}

/**
 * One fact per figure, so an article never lists the same milestone twice
 * and never mistakes a relayed number for a new one. In order:
 *
 * 1. Players reached equal to a sales figure (same platform) is the same
 *    number misfiled as engagement: dropped.
 * 2. Press figures within 1% of an analyst estimate (same kind/platform,
 *    ±14 days) are that estimate relayed: dropped.
 * 3. Press figures within 3% of a more trusted figure (±14 days) are a
 *    rounded relay ("7 million" for an official 6.9): dropped.
 * 4. Analyst estimates: only the newest per kind/platform (a newer one is
 *    a revision of the older).
 * 5. The same number from several sources is one milestone: keep the most
 *    trusted source, then the earliest report.
 * 6. A total cannot go down: a lower figure reported after a higher one
 *    (not an estimate) is an old number repeated: dropped.
 *
 * Release year and signals pass through. Input order is kept.
 */
export function consolidateFacts<T extends FactFields>(facts: T[]): T[] {
  const isRecord = (f: T) => f.kind === 'sales' || f.kind === 'engagement';
  const group = (f: T) => `${f.kind}|${f.platform}|${f.isAlinea}`;
  const scope = (f: T) => `${f.kind}|${f.platform}`;
  const isPress = (f: T) => !f.isAlinea && f.source === 'MEDIA';

  let pool = facts.filter(isRecord);

  pool = pool.filter(
    (f) =>
      f.kind !== 'engagement' ||
      !pool.some(
        (s) =>
          s.kind === 'sales' &&
          s.platform === f.platform &&
          within(s.value, f.value, 0.01),
      ),
  );
  pool = pool.filter(
    (f) =>
      !isPress(f) ||
      !pool.some(
        (e) =>
          e.isAlinea &&
          scope(e) === scope(f) &&
          within(e.value, f.value, 0.01) &&
          daysApart(e.date, f.date) <= 14,
      ),
  );
  pool = pool.filter(
    (f) =>
      !isPress(f) ||
      !pool.some(
        (o) =>
          !o.isAlinea &&
          o !== f &&
          scope(o) === scope(f) &&
          factRank(o) < factRank(f) &&
          o.value !== f.value &&
          within(o.value, f.value, 0.03) &&
          daysApart(o.date, f.date) <= 14,
      ),
  );
  pool = pool.filter(
    (f) =>
      !f.isAlinea ||
      !pool.some(
        (o) =>
          o.isAlinea &&
          scope(o) === scope(f) &&
          (o.date ?? '') > (f.date ?? ''),
      ),
  );

  const preferred = [...pool].sort(
    (a, b) =>
      factRank(a) - factRank(b) ||
      (a.date ?? '9999').localeCompare(b.date ?? '9999'),
  );
  const unique: T[] = [];
  for (const fact of preferred) {
    const duplicate = unique.some(
      (k) => group(k) === group(fact) && within(k.value, fact.value, 0.005),
    );
    if (!duplicate) unique.push(fact);
  }

  const kept = new Set(
    unique.filter(
      (fact) =>
        fact.isAlinea ||
        !unique.some(
          (other) =>
            group(other) === group(fact) &&
            other.value > fact.value &&
            !!other.date &&
            !!fact.date &&
            other.date < fact.date,
        ),
    ),
  );
  return facts.filter((f) => !isRecord(f) || kept.has(f));
}

/** Facts an article states as sourced figures (not release year or live signals). */
export function recordFacts(facts: BlogFact[] | FactFields[]): FactFields[] {
  return facts.filter((f) => f.kind === 'sales' || f.kind === 'engagement');
}

function factKey(f: FactFields): string {
  return [f.kind, f.platform, f.source, f.value, f.date ?? ''].join('|');
}

function describe(f: FactFields): string {
  const scope = f.platform === 'GLOBAL' ? '' : ` (${f.platform})`;
  return `${f.value.toLocaleString('en-US')} ${f.unit}${scope} — ${f.sourceName}${f.date ? `, ${f.date}` : ''}`;
}

/** Stable id of a set of sourced figures, used to acknowledge a known change. */
export function factsFingerprint(facts: FactFields[]): string {
  return recordFacts(facts).map(factKey).sort().join('\n');
}

/** What changed between the figures an article was written from and today's. */
export function compareFacts(
  frozen: FactFields[],
  current: FactFields[],
): Omit<BlogFreshness, 'stale'> {
  // Older packs were frozen before consolidation: compare like with like.
  const before = new Map(
    recordFacts(consolidateFacts(frozen)).map((f) => [factKey(f), f]),
  );
  const now = new Map(recordFacts(current).map((f) => [factKey(f), f]));
  const byDateDesc = (a: FactFields, b: FactFields) =>
    (b.date ?? '').localeCompare(a.date ?? '');
  return {
    added: [...now.entries()]
      .filter(([key]) => !before.has(key))
      .map(([, f]) => f)
      .sort(byDateDesc)
      .map(describe),
    removed: [...before.entries()]
      .filter(([key]) => !now.has(key))
      .map(([, f]) => f)
      .sort(byDateDesc)
      .map(describe),
  };
}

/** Date of the newest sourced figure in a pack: what the article is "as of". */
export function figuresAsOf(
  pack: BlogFactPack | null | undefined,
): string | null {
  const dates = recordFacts(pack?.facts ?? [])
    .map((f) => f.date)
    .filter((d): d is string => !!d)
    .sort();
  return dates.at(-1) ?? null;
}

const SIGNALS: {
  metric: SignalMetric;
  unit: string;
  platform: Platform;
  sourceName: string;
  label: string;
}[] = [
  {
    metric: SignalMetric.STEAM_REVIEWS,
    unit: 'reviews',
    platform: Platform.PC,
    sourceName: 'Steam',
    label:
      'total number of Steam user reviews at that date; a popularity signal, NOT sales',
  },
  {
    metric: SignalMetric.STEAM_PEAK_CCU,
    unit: 'players',
    platform: Platform.PC,
    sourceName: 'Steam',
    label:
      'highest number of people playing at the same time on Steam on record (date = when that peak was recorded); a popularity signal, NOT sales and NOT total players',
  },
  {
    metric: SignalMetric.PS_RATINGS,
    unit: 'ratings',
    platform: Platform.PLAYSTATION,
    sourceName: 'PlayStation Store',
    label:
      'number of user ratings on the PlayStation Store at that date; a popularity signal, NOT sales',
  },
  {
    metric: SignalMetric.XBOX_RATINGS,
    unit: 'ratings',
    platform: Platform.XBOX,
    sourceName: 'Xbox Store',
    label:
      'number of user ratings on the Xbox Store at that date; a popularity signal, NOT sales',
  },
];

@Injectable()
export class BlogFactPackService {
  constructor(
    @InjectRepository(Game)
    private readonly games: Repository<Game>,
    @InjectRepository(Milestone)
    private readonly milestones: Repository<Milestone>,
    @InjectRepository(SignalSnapshot)
    private readonly signals: Repository<SignalSnapshot>,
  ) {}

  async buildForGame(gameId: string): Promise<BlogFactPack> {
    const game = await this.games.findOne({ where: { id: gameId } });
    if (!game) throw new NotFoundException(`Game ${gameId} not found`);

    const facts: BlogFact[] = [];
    let n = 1;
    const push = (fact: FactFields) => facts.push({ id: `F${n++}`, ...fact });

    if (game.releaseDate) {
      push({
        kind: 'release',
        value: game.releaseDate.getUTCFullYear(),
        unit: 'year',
        platform: Platform.GLOBAL,
        source: 'RELEASE',
        sourceName: 'release date',
        date: game.releaseDate.toISOString().slice(0, 10),
        isEngagement: false,
        isAlinea: false,
        label: 'year the game was first released',
      });
    }

    for (const fact of await this.currentMilestoneFacts(gameId, game)) {
      push(fact);
    }

    for (const signal of SIGNALS) {
      const snap = await this.signals.findOne({
        where: { gameId, metric: signal.metric, synthetic: false },
        order:
          signal.metric === SignalMetric.STEAM_PEAK_CCU
            ? { value: 'DESC' }
            : { capturedAt: 'DESC' },
      });
      if (!snap) continue;
      push({
        kind: 'signal',
        value: snap.value,
        unit: signal.unit,
        platform: signal.platform,
        source: signal.metric,
        sourceName: signal.sourceName,
        date: snap.capturedAt.toISOString().slice(0, 10),
        isEngagement: false,
        isAlinea: false,
        label: signal.label,
      });
    }

    const base = publicAppUrl();
    return {
      game: {
        id: game.id,
        name: game.name,
        slug: game.slug,
        releaseDate: game.releaseDate
          ? game.releaseDate.toISOString().slice(0, 10)
          : null,
        publisher: game.publisher,
        developer: game.developer,
        platforms: game.platforms,
        coverUrl: game.coverUrl,
      },
      facts,
      gameUrlByLocale: {
        en: `${base}/en/game/${game.slug}`,
        fr: `${base}/fr/game/${game.slug}`,
      },
    };
  }

  /** Today's blog-eligible milestones, one fact per figure, newest first. */
  async currentMilestoneFacts(
    gameId: string,
    game: GameNames = {},
  ): Promise<FactFields[]> {
    const rows = await this.milestones.find({
      where: { gameId, ...Milestone.notRejected() },
      order: { reportedAt: 'DESC' },
    });
    return milestoneFacts(rows, game);
  }

  salesFacts(pack: BlogFactPack): BlogFact[] {
    return pack.facts.filter((f) => f.kind === 'sales');
  }
}

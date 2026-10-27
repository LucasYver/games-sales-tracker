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

/** What a milestone number measures, spelled out so the writer cannot blur it. */
function milestoneLabel(row: Milestone, sourceName: string): string {
  const scope =
    row.platform === Platform.GLOBAL
      ? 'worldwide, all platforms'
      : `on ${PLATFORM_NAME[row.platform] ?? row.platform} only — NOT a worldwide total`;
  const what = row.isEngagement
    ? `players/users reached (${scope}); may include subscription or free access such as Game Pass — NOT copies sold`
    : `cumulative copies sold (${scope})`;
  if (isAlineaMilestone(row)) {
    return `${what}; third-party ESTIMATE by Alinea Analytics, not an official figure`;
  }
  switch (row.source) {
    case SalesSource.OFFICIAL:
      return `${what}; official figure stated by ${sourceName}`;
    case SalesSource.ANNOUNCEMENT:
      return `${what}; announced by ${sourceName}`;
    case SalesSource.WIKIPEDIA:
      return `${what}; figure cited on Wikipedia`;
    default:
      return `${what}; reported by ${sourceName} (press/analyst), not a publisher statement`;
  }
}

/** Blog-eligible milestones as facts (no ids). Leaks and model estimates stay out. */
export function milestoneFacts(rows: Milestone[]): FactFields[] {
  const facts: FactFields[] = [];
  for (const row of rows) {
    if (!isBlogEligibleMilestone(row)) continue;
    const sourceName = sourceDisplayName(row);
    facts.push({
      kind: row.isEngagement ? 'engagement' : 'sales',
      value: row.units,
      unit: row.isEngagement ? 'players' : 'copies',
      platform: row.platform,
      source: row.source,
      sourceName,
      date: row.reportedAt ? row.reportedAt.toISOString().slice(0, 10) : null,
      isEngagement: row.isEngagement,
      isAlinea: isAlineaMilestone(row),
      label: milestoneLabel(row, sourceName),
      sourceUrl: row.sourceUrl,
    });
  }
  return facts;
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
  const before = new Map(recordFacts(frozen).map((f) => [factKey(f), f]));
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

    for (const fact of await this.currentMilestoneFacts(gameId)) push(fact);

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

  /** Today's blog-eligible milestones, newest first. */
  async currentMilestoneFacts(gameId: string): Promise<FactFields[]> {
    const rows = await this.milestones.find({
      where: { gameId, ...Milestone.notRejected() },
      order: { reportedAt: 'DESC' },
    });
    return milestoneFacts(rows);
  }

  salesFacts(pack: BlogFactPack): BlogFact[] {
    return pack.facts.filter((f) => f.kind === 'sales');
  }
}

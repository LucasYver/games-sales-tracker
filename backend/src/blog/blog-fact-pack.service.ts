import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Game,
  Milestone,
  Platform,
  SignalMetric,
  SignalSnapshot,
} from '../entities';
import {
  isAlineaMilestone,
  isBlogEligibleMilestone,
  isHighTrustSalesMilestone,
  sourceDisplayName,
} from './blog-alinea';
import type { BlogFact, BlogFactPack } from './blog.types';
import { publicAppUrl } from './blog.types';

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

    const rows = await this.milestones.find({
      where: { gameId, ...Milestone.notRejected() },
      order: { reportedAt: 'DESC' },
    });

    const facts: BlogFact[] = [];
    let n = 1;
    const nextId = () => `F${n++}`;

    if (game.releaseDate) {
      facts.push({
        id: nextId(),
        kind: 'release',
        value: game.releaseDate.getUTCFullYear(),
        unit: 'year',
        platform: Platform.GLOBAL,
        source: 'RELEASE',
        sourceName: 'release date',
        date: game.releaseDate.toISOString().slice(0, 10),
        isEngagement: false,
        isAlinea: false,
      });
    }

    for (const row of rows) {
      if (!isBlogEligibleMilestone(row)) continue;
      facts.push({
        id: nextId(),
        kind: row.isEngagement ? 'engagement' : 'sales',
        value: row.units,
        unit: row.isEngagement ? 'players' : 'copies',
        platform: row.platform,
        source: row.source,
        sourceName: sourceDisplayName(row),
        date: row.reportedAt ? row.reportedAt.toISOString().slice(0, 10) : null,
        isEngagement: row.isEngagement,
        isAlinea: isAlineaMilestone(row),
        sourceUrl: row.sourceUrl,
      });
    }

    const latestSignals: { metric: SignalMetric; unit: string }[] = [
      { metric: SignalMetric.STEAM_REVIEWS, unit: 'reviews' },
      { metric: SignalMetric.STEAM_PEAK_CCU, unit: 'ccu' },
      { metric: SignalMetric.PS_RATINGS, unit: 'ratings' },
      { metric: SignalMetric.XBOX_RATINGS, unit: 'ratings' },
    ];
    for (const { metric, unit } of latestSignals) {
      const snap = await this.signals.findOne({
        where: { gameId, metric, synthetic: false },
        order:
          metric === SignalMetric.STEAM_PEAK_CCU
            ? { value: 'DESC' }
            : { capturedAt: 'DESC' },
      });
      if (!snap) continue;
      facts.push({
        id: nextId(),
        kind: 'signal',
        value: snap.value,
        unit,
        platform:
          metric === SignalMetric.PS_RATINGS
            ? Platform.PLAYSTATION
            : metric === SignalMetric.XBOX_RATINGS
              ? Platform.XBOX
              : Platform.PC,
        source: metric,
        sourceName: metric.replace(/_/g, ' ').toLowerCase(),
        date: snap.capturedAt.toISOString().slice(0, 10),
        isEngagement: false,
        isAlinea: false,
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

  salesFacts(pack: BlogFactPack): BlogFact[] {
    return pack.facts.filter((f) => f.kind === 'sales');
  }

  isEligiblePool(pack: BlogFactPack): boolean {
    const sales = this.salesFacts(pack);
    if (sales.length < 2) return false;
    return sales.some(
      (f) => f.isAlinea || f.source === 'OFFICIAL' || f.source === 'WIKIPEDIA',
    );
  }

  /** Used by the scorer without rebuilding signals twice. */
  highTrustSales(pack: BlogFactPack): BlogFact[] {
    return this.salesFacts(pack).filter(
      (f) => f.isAlinea || f.source === 'OFFICIAL' || f.source === 'WIKIPEDIA',
    );
  }

  milestoneIsHighTrust(row: Milestone): boolean {
    return isHighTrustSalesMilestone(row);
  }
}

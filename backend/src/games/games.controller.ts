import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { GamesService } from './games.service';
import { Platform } from '../entities/enums';
import type { GameMode } from './igdb-facts';

/** Platforms the public listing filters on. */
const LISTING_PLATFORMS: Platform[] = [
  Platform.PC,
  Platform.PLAYSTATION,
  Platform.XBOX,
  Platform.SWITCH,
];

/** Game modes the public listing filters on (IGDB `game_modes`). */
const LISTING_MODES: GameMode[] = ['SINGLE_PLAYER', 'MULTIPLAYER', 'CO_OP'];

/** A comma-separated query value (`PC,XBOX`) as trimmed, unique tokens. */
function parseList(value?: string): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

@Controller('games')
export class GamesController {
  constructor(private readonly games: GamesService) {}

  @Get('search')
  search(@Query('q') q = '', @Query('limit') limit?: string) {
    const parsed = Number(limit);
    const take =
      Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 20) : 8;
    return this.games.searchDetailed(q, take);
  }

  @Get('popular')
  popular(
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
    @Query('platform') platform?: string,
    @Query('offset') offset?: string,
    @Query('genre') genre?: string,
    @Query('status') status?: string,
    @Query('yearMin') yearMin?: string,
    @Query('yearMax') yearMax?: string,
    @Query('minReviews') minReviews?: string,
    @Query('mode') mode?: string,
    @Query('hideFree') hideFree?: string,
    @Query('exclusive') exclusive?: string,
  ) {
    const validSort = [
      'trending',
      'popular',
      'recent',
      'oldest',
      'sales',
    ].includes(sort ?? '')
      ? (sort as 'trending' | 'popular' | 'recent' | 'oldest' | 'sales')
      : 'popular';
    const validStatus = ['released', 'new', 'upcoming'].includes(status ?? '')
      ? (status as 'released' | 'new' | 'upcoming')
      : undefined;
    const parseInt = (v?: string): number | undefined => {
      if (!v) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    return this.games.listPopular({
      limit: parseInt(limit),
      sort: validSort,
      platforms: parseList(platform).filter((p) =>
        LISTING_PLATFORMS.includes(p as Platform),
      ) as Platform[],
      offset: parseInt(offset),
      genres: parseList(genre),
      status: validStatus,
      yearMin: parseInt(yearMin),
      yearMax: parseInt(yearMax),
      minReviews: parseInt(minReviews),
      modes: parseList(mode).filter((m) =>
        LISTING_MODES.includes(m as GameMode),
      ) as GameMode[],
      hideFree: hideFree === '1' || hideFree === 'true',
      exclusive: exclusive === '1' || exclusive === 'true',
    });
  }

  @Get('genres')
  genres() {
    return this.games.listGenres();
  }

  @Get('sitemap')
  sitemap() {
    return this.games.listSitemap();
  }

  @Get('hubs')
  hubs() {
    return this.games.listHubs();
  }

  @Get('studios')
  studios() {
    return this.games.listStudios();
  }

  @Get('publishers')
  publishers() {
    return this.games.listPublishers();
  }

  @Get('franchises')
  franchises() {
    return this.games.listFranchises();
  }

  @Get('studios/:slug')
  studio(@Param('slug') slug: string) {
    return this.games.getStudioHub(slug);
  }

  @Get('studios/:slug/timeline')
  studioTimeline(@Param('slug') slug: string) {
    return this.games.getStudioTimeline(slug);
  }

  @Get('publishers/:slug')
  publisher(@Param('slug') slug: string) {
    return this.games.getPublisherHub(slug);
  }

  @Get('publishers/:slug/timeline')
  publisherTimeline(@Param('slug') slug: string) {
    return this.games.getPublisherTimeline(slug);
  }

  @Get('franchises/:slug/timeline')
  franchiseTimeline(@Param('slug') slug: string) {
    return this.games.getFranchiseTimeline(slug);
  }

  @Get('franchises/:slug')
  franchise(@Param('slug') slug: string) {
    return this.games.getFranchiseHub(slug);
  }

  @Get(':slug/redirect')
  async redirect(@Param('slug') slug: string) {
    const target = await this.games.findRedirectSlug(slug);
    if (!target) throw new NotFoundException(`No redirect for "${slug}"`);
    return target;
  }

  @Get(':slug/sales-timeline')
  salesTimeline(@Param('slug') slug: string) {
    return this.games.getSalesTimeline(slug);
  }

  @Get(':slug/steam-review-curve')
  steamReviewCurve(@Param('slug') slug: string) {
    return this.games.getSteamReviewCurve(slug);
  }

  @Get(':slug/related')
  related(@Param('slug') slug: string) {
    return this.games.listRelated(slug);
  }

  @Get(':slug')
  getBySlug(
    @Param('slug') slug: string,
    @Query('country') country?: string,
    @Query('store') store?: string,
  ) {
    return this.games.getBySlug(slug, country, store);
  }
}

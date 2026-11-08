import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { GamesService } from './games.service';

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
      platform,
      offset: parseInt(offset),
      genre,
      status: validStatus,
      yearMin: parseInt(yearMin),
      yearMax: parseInt(yearMax),
      minReviews: parseInt(minReviews),
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

  @Get('publishers/:slug')
  publisher(@Param('slug') slug: string) {
    return this.games.getPublisherHub(slug);
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

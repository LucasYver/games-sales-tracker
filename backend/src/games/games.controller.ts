import { Controller, Get, Param, Query } from '@nestjs/common';
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
    const validSort = ['popular', 'recent', 'oldest'].includes(sort ?? '')
      ? (sort as 'popular' | 'recent' | 'oldest')
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

  @Get('ranked')
  ranked(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('sort') sort?: string,
  ) {
    const num = (v?: string): number | undefined => {
      if (!v) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const validSort = ['top', 'peak', 'weeks'].includes(sort ?? '')
      ? (sort as 'top' | 'peak' | 'weeks')
      : 'top';
    return this.games.listRanked({
      limit: num(limit),
      offset: num(offset),
      sort: validSort,
    });
  }

  @Get('genres')
  genres() {
    return this.games.listGenres();
  }

  @Get(':slug')
  getBySlug(@Param('slug') slug: string) {
    return this.games.getBySlug(slug);
  }
}

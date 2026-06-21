import { Controller, Get, Param, Query } from '@nestjs/common';
import { GamesService } from './games.service';

@Controller('games')
export class GamesController {
  constructor(private readonly games: GamesService) {}

  @Get('search')
  search(@Query('q') q = '') {
    return this.games.search(q);
  }

  @Get('popular')
  popular(
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
    @Query('platform') platform?: string,
    @Query('offset') offset?: string,
  ) {
    const validSort = ['popular', 'recent', 'oldest'].includes(sort ?? '')
      ? (sort as 'popular' | 'recent' | 'oldest')
      : 'popular';
    return this.games.listPopular(
      limit ? Number(limit) : undefined,
      validSort,
      platform,
      offset ? Number(offset) : undefined,
    );
  }

  @Get(':slug')
  getBySlug(@Param('slug') slug: string) {
    return this.games.getBySlug(slug);
  }
}
